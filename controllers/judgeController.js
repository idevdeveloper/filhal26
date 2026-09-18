const Result = require('../models/Result');
const Program = require('../models/Program');
const User = require('../models/User');
const bcrypt = require('bcryptjs');

exports.getLogin = (req, res) => {
    res.render('judge/login', { layout: 'main' });
};

exports.postLogin = async (req, res) => {
    try {
        const { name, password } = req.body;
        const judge = await User.findOne({ name, role: 'JUDGE' });
        
        if (!judge) {
            return res.render('judge/login', { layout: 'main', error: 'Invalid Judge Credentials' });
        }

        const isMatch = await bcrypt.compare(password, judge.password);
        if (!isMatch) {
            return res.render('judge/login', { layout: 'main', error: 'Invalid Judge Credentials' });
        }

        req.session.judge = judge;
        req.session.save(() => {
            res.redirect('/judge/dashboard');
        });
    } catch (err) {
        res.status(500).send('Login error: ' + err.message);
    }
};

exports.getDashboard = async (req, res) => {
    if (!req.session.judge) return res.redirect('/judge/login');
    try {
        const programs = await Program.find({}).sort({ name: 1 }).lean();
        res.render('judge/dashboard', { 
            layout: 'main', 
            judge: req.session.judge, 
            programs, 
            success: req.query.success, 
            error: req.query.error 
        });
    } catch (err) {
        res.status(500).send('Error loading dashboard: ' + err.message);
    }
};

exports.getProgramParticipants = async (req, res) => {
    if (!req.session.judge) return res.status(401).json({ error: 'Unauthorized' });
    try {
        const program = await Program.findById(req.params.programId).lean();
        if (!program) return res.status(404).json({ error: 'Program not found' });

        if (program.category === 'Team') {
            const teamOptions = [
                { _id: 'Hermos', name: 'Hermos', team: 'Hermos', chessNumber: 'TEAM' },
                { _id: 'Gibraltar', name: 'Gibraltar', team: 'Gibraltar', chessNumber: 'TEAM' }
            ];
            return res.json({ isGroup: false, isTeamCategory: true, options: teamOptions });
        }

        const participants = await User.find({ 
            role: 'PARTICIPANT', 
            programs: req.params.programId 
        }).lean();

        res.json({ isGroup: program.type === 'Group', isTeamCategory: false, options: participants });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

exports.submitResult = async (req, res) => {
    if (!req.session.judge) return res.status(401).send('Unauthorized');
    try {
        const { programId, firstPlace, secondPlace, thirdPlace } = req.body;
        
        if (!programId || (!firstPlace && !secondPlace && !thirdPlace)) {
            throw new Error("Please select a program and at least one placement.");
        }

        const programDoc = await Program.findById(programId);
        if (!programDoc) {
            throw new Error(`The selected program does not exist.`);
        }

        // Team category & General section group/general programs get 20, 15, 10. Senior/Junior/Sub-Junior group programs get 10, 7, 5.
        const isTeamOrGeneralGroup = (programDoc.category === 'Team') || (programDoc.category === 'General' && programDoc.type === 'Group');
        const p1Points = isTeamOrGeneralGroup ? 20 : 10;
        const p2Points = isTeamOrGeneralGroup ? 15 : 7;
        const p3Points = isTeamOrGeneralGroup ? 10 : 5;

        const savePlacement = async (placementInput, scorePoints, positionNum) => {
            if (!placementInput) return;
            
            let participantIds = [];
            let teamName = '';

            if (programDoc.category === 'Team') {
                teamName = placementInput.trim();
                participantIds = [];
            } else if (Array.isArray(placementInput)) {
                participantIds = placementInput.map(id => id.trim()).filter(id => id);
                if (participantIds.length > 0) {
                    const firstUser = await User.findById(participantIds[0]);
                    if (!firstUser) throw new Error(`Selected participant not found.`);
                    teamName = firstUser.team;
                }
            } else if (typeof placementInput === 'string' && placementInput.trim() !== '') {
                participantIds = [placementInput.trim()];
                const userDoc = await User.findOne({ _id: participantIds[0], role: 'PARTICIPANT' });
                if (!userDoc) throw new Error(`Selected participant not found.`);
                teamName = userDoc.team;
            }

            if (programDoc.category !== 'Team' && participantIds.length === 0) return;

            await Result.create({
                program: programDoc._id,
                participants: participantIds,
                team: teamName,
                score: scorePoints,
                position: positionNum,
                isTeamCategoryProgram: programDoc.category === 'Team',
                status: 'draft', 
                judgedBy: req.session.judge._id
            });
        };

        await savePlacement(firstPlace, p1Points, 1);
        await savePlacement(secondPlace, p2Points, 2);
        await savePlacement(thirdPlace, p3Points, 3);

        res.redirect('/judge/dashboard?success=Results submitted successfully for admin review!');
    } catch (error) {
        res.redirect('/judge/dashboard?error=' + encodeURIComponent(error.message));
    }
};

exports.getMyResults = async (req, res) => {
    if (!req.session.judge) return res.redirect('/judge/login');
    try {
        const results = await Result.find({ judgedBy: req.session.judge._id })
            .populate('program')
            .populate('participants')
            .sort({ createdAt: -1 })
            .lean();

        res.render('judge/my-results', { layout: 'main', judge: req.session.judge, results, success: req.query.success, error: req.query.error });
    } catch (err) {
        res.status(500).send('Error loading results');
    }
};

exports.getEditResult = async (req, res) => {
    if (!req.session.judge) return res.redirect('/judge/login');
    try {
        const result = await Result.findOne({ _id: req.params.id, judgedBy: req.session.judge._id })
            .populate('program')
            .populate('participants')
            .lean();

        if (!result) throw new Error("Result not found or unauthorized.");
        res.render('judge/edit-result', { layout: 'main', judge: req.session.judge, result });
    } catch (err) {
        res.redirect('/judge/results?error=' + encodeURIComponent(err.message));
    }
};

exports.postEditResult = async (req, res) => {
    if (!req.session.judge) return res.status(401).send('Unauthorized');
    try {
        const { position, score } = req.body;
        const result = await Result.findOne({ _id: req.params.id, judgedBy: req.session.judge._id });
        if (!result) throw new Error("Result not found.");

        result.score = parseFloat(score);
        result.position = parseInt(position);
        result.status = 'draft'; 
        await result.save();

        res.redirect('/judge/results?success=Result updated successfully');
    } catch (err) {
        res.redirect('/judge/results?error=' + encodeURIComponent(err.message));
    }
};

exports.logout = (req, res) => {
    req.session.judge = null;
    req.session.destroy(() => {
        res.redirect('/judge/login');
    });
};

module.exports = exports;