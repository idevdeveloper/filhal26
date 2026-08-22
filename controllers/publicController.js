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

async function getTopChampion(category, gender) {
    try {
        const leaderboard = await Result.aggregate([
            {
                $lookup: {
                    from: 'users',
                    localField: 'participants', // Fixed to match array field name
                    foreignField: '_id',
                    as: 'participantInfo'
                }
            },
            { $unwind: '$participantInfo' },
            { 
                $match: { 
                    'participantInfo.category': category, 
                    'participantInfo.gender': gender,
                    'participantInfo.role': 'PARTICIPANT',
                    'status': 'published'
                } 
            },
            {
                $group: {
                    _id: '$participantInfo._id',
                    name: { $first: '$participantInfo.name' },
                    chestNumber: { $first: '$participantInfo.chessNumber' },
                    team: { $first: '$participantInfo.team' },
                    totalPoints: { $sum: '$score' }
                }
            },
            { $sort: { totalPoints: -1 } },
            { $limit: 1 }
        ]);

        return leaderboard[0] || { name: 'Yet to be decided', chestNumber: '-', team: '-', totalPoints: 0 };
    } catch (err) {
        return { name: 'Error', chestNumber: '-', team: '-', totalPoints: 0 };
    }
}

router.get('/champions', async (req, res) => {
    const publishSetting = await Setting.findOne({ key: 'championsPublished' });
    const isPublished = publishSetting ? publishSetting.value : false;

    if (!isPublished) {
        return res.render('public/champions-hidden', { title: 'Champions - Filhal Fest' });
    }

    const champions = {
        subJuniorBoys: await getTopChampion('Sub Junior', 'Boys'),
        subJuniorGirls: await getTopChampion('Sub Junior', 'Girls'),
        juniorBoys: await getTopChampion('Junior', 'Boys'),
        juniorGirls: await getTopChampion('Junior', 'Girls'),
        seniorBoys: await getTopChampion('Senior', 'Boys'),
        seniorGirls: await getTopChampion('Senior', 'Girls')
    };

    res.render('public/champions', { champions, title: 'Individual Champions - Filhal Fest' });
});

module.exports = router;