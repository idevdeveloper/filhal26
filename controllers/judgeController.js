const Result = require('../models/Result');
const Program = require('../models/Program');
const User = require('../models/User');
const bcrypt = require('bcryptjs');
const { validateResultEntry } = require('../services/validationService');

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

// API endpoint to fetch participants enrolled in a specific program for dropdowns
exports.getProgramParticipants = async (req, res) => {
    if (!req.session.judge) return res.status(401).json({ error: 'Unauthorized' });
    try {
        const participants = await User.find({ 
            role: 'PARTICIPANT', 
            programs: req.params.programId 
        }).lean();
        res.json(participants);
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

        // A program gets higher points (20/15/10) if its Category is 'Team' or 'General'
        const isHigherPoints = (programDoc.category === 'General' || programDoc.category === 'Team');
        const p1Points = isHigherPoints ? 20 : 10;
        const p2Points = isHigherPoints ? 15 : 7;
        const p3Points = isHigherPoints ? 10 : 5;

        const savePlacement = async (participantId, scorePoints, positionNum) => {
            if (!participantId || !participantId.trim()) return;
            
            const userDoc = await User.findOne({ _id: participantId, role: 'PARTICIPANT' });
            if (!userDoc) throw new Error(`Selected participant not found.`);

            await Result.create({
                program: programDoc._id,
                participants: [userDoc._id],
                team: userDoc.team,
                score: scorePoints,
                position: positionNum,
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