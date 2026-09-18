const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const User = require('../models/User');
const Result = require('../models/Result');
const Program = require('../models/Program');
const { calculateTeamScores } = require('../services/scoringService');
const Setting = require('../models/Setting');

// --- PUBLIC RESULTS PAGE ---
router.get('/results', async (req, res) => {
    const { search, category, gender, section, type } = req.query;
    
    let progFilter = {};
    if (search) progFilter.name = { $regex: search, $options: 'i' };
    if (category) progFilter.category = category;
    if (gender) progFilter.gender = gender;
    if (section) progFilter.section = section;
    if (type) progFilter.type = type;

    const programs = await Program.find(progFilter);
    const programIds = programs.map(p => p._id);

    const results = await Result.find({ program: { $in: programIds }, status: 'published' })
        .populate('program')
        .populate('participants')
        .sort({ score: -1 })
        .lean();

    const groupedResults = {};
    
    results.forEach(result => {
        const pId = result.program._id.toString();
        if (!groupedResults[pId]) {
            groupedResults[pId] = {
                program: result.program,
                results: []
            };
        }
        groupedResults[pId].results.push(result);
    });

    Object.values(groupedResults).forEach(group => {
        let currentRank = 1;
        for (let i = 0; i < group.results.length; i++) {
            if (i > 0 && group.results[i].score < group.results[i-1].score) {
                currentRank = i + 1;
            }
            group.results[i].position = currentRank;
            
            if (req.session.participant) {
                group.results[i].isMine = group.results[i].participants.some(p => p._id.toString() === req.session.participant._id.toString());
            }
        }
    });

    res.render('public/results', { 
        layout: 'main', 
        groupedResults: Object.values(groupedResults)
    });
});

// --- PUBLIC HOMEPAGE ---
router.get('/', async (req, res) => {
    const { scores, champion } = await calculateTeamScores();
    
    const recentResults = await Result.find({ status: 'published' })
        .populate('program')
        .populate('participants')
        .sort({ createdAt: -1 })
        .limit(3)
        .lean();

    res.render('public/home', { 
        layout: 'main', 
        scores,
        champion,
        recentResults
    });
});

// --- TEAM STANDINGS ---
router.get('/team-results', async (req, res) => {
    try {
        const { scores, champion } = await calculateTeamScores();
        res.render('public/team-results', { 
            layout: 'main', 
            scores,
            champion
        });
    } catch (error) {
        res.render('public/team-results', { layout: 'main', error: error.message });
    }
});

// --- PARTICIPANT AUTHENTICATION ---
router.get('/login', (req, res) => {
    if (req.session.admin) return res.redirect('/admin/dashboard');
    if (req.session.participant) return res.redirect('/participant/dashboard');
    res.render('public/login', { layout: 'main', role: 'Participant' });
});

router.post('/login', async (req, res) => {
    const { chessNumber, password } = req.body;
    try {
        const user = await User.findOne({ chessNumber, role: 'PARTICIPANT' }).lean();
        if (!user) throw new Error('Invalid Chess Number or Password.');
        
        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) throw new Error('Invalid Chess Number or Password.');
        
        req.session.admin = null;
        req.session.participant = user;
        
        req.session.save(() => {
            res.redirect('/participant/dashboard');
        });
    } catch (error) {
        res.render('public/login', { layout: 'main', role: 'Participant', error: error.message });
    }
});

// --- ADMIN AUTHENTICATION ---
router.get('/admin/login', (req, res) => {
    if (req.session.admin) return res.redirect('/admin/dashboard');
    res.render('public/login', { layout: 'main', role: 'Admin', isAdmin: true });
});

router.post('/admin/login', async (req, res) => {
    const { username, password } = req.body;
    try {
        const admin = await User.findOne({ name: username, role: 'ADMIN' }).lean();
        if (!admin) throw new Error('Invalid Admin Credentials.');
        
        const isMatch = await bcrypt.compare(password, admin.password);
        if (!isMatch) throw new Error('Invalid Admin Credentials.');
        
        req.session.participant = null;
        req.session.admin = admin;
        
        req.session.save(() => {
            res.redirect('/admin/dashboard');
        });
    } catch (error) {
        res.render('public/login', { layout: 'main', role: 'Admin', isAdmin: true, error: error.message });
    }
});

// --- LOGOUT ---
router.get('/logout', (req, res) => {
    req.session.admin = null;
    req.session.participant = null;
    req.session.user = null;
    req.session.destroy(() => {
        res.redirect('/');
    });
});

async function getCategoryLeaderboardData(category, gender) {
    try {
        const results = await Result.find({ status: 'published' })
            .populate('program')
            .populate('participants')
            .lean();

        const studentMap = {};

        results.forEach(resItem => {
            const prog = resItem.program;
            if (!prog) return;

            // Exclude General category (both individual and group) and any group programs
            const categoryStr = (prog.category || '').toLowerCase();
            const typeStr = (prog.type || '').toLowerCase();
            
            if (categoryStr === 'general' || typeStr === 'group') {
                return;
            }

            if (!resItem.participants || resItem.participants.length === 0) return;

            resItem.participants.forEach(participant => {
                if (
                    participant.category === category &&
                    participant.gender === gender &&
                    participant.role === 'PARTICIPANT'
                ) {
                    const pId = participant._id.toString();
                    if (!studentMap[pId]) {
                        studentMap[pId] = {
                            _id: participant._id,
                            name: participant.name,
                            chestNumber: participant.chessNumber,
                            team: participant.team,
                            totalPoints: 0,
                            programs: []
                        };
                    }

                    studentMap[pId].totalPoints += resItem.score;
                    studentMap[pId].programs.push({
                        programName: prog.name,
                        score: resItem.score,
                        position: resItem.position || '-'
                    });
                }
            });
        });

        const leaderboard = Object.values(studentMap).sort((a, b) => b.totalPoints - a.totalPoints);

        const filteredList = leaderboard.map((item, index) => ({
            ...item,
            rank: index + 1
        }));

        const champion = filteredList[0] || { name: 'Yet to be decided', chestNumber: '-', team: '-', totalPoints: 0, rank: '-', programs: [] };

        return {
            champion,
            leaderboard: filteredList
        };
    } catch (err) {
        return {
            champion: { name: 'Error', chestNumber: '-', team: '-', totalPoints: 0, rank: '-', programs: [] },
            leaderboard: []
        };
    }
}

router.get('/champions', async (req, res) => {
    // Public access enabled for everyone
    const champions = {
        subJuniorBoysData: await getCategoryLeaderboardData('Sub Junior', 'Boys'),
        subJuniorGirlsData: await getCategoryLeaderboardData('Sub Junior', 'Girls'),
        juniorBoysData: await getCategoryLeaderboardData('Junior', 'Boys'),
        juniorGirlsData: await getCategoryLeaderboardData('Junior', 'Girls'),
        seniorBoysData: await getCategoryLeaderboardData('Senior', 'Boys'),
        seniorGirlsData: await getCategoryLeaderboardData('Senior', 'Girls')
    };

    res.render('public/champions', { champions, title: 'Individual Champions & Leaderboards - Filhal Fest' });
});

module.exports = router;