const express = require('express');
const router = express.Router();
const { requireAdmin } = require('../middleware/auth');
const User = require('../models/User'); 
const Program = require('../models/Program');
const Result = require('../models/Result');
const { validateResultEntry } = require('../services/validationService');
const Setting = require('../models/Setting');

const isAdmin = (req, res, next) => req.session.admin ? next() : res.redirect('/admin/login');

router.get('/dashboard', isAdmin, async (req, res) => {
    const totalParticipants = await User.countDocuments({ role: 'PARTICIPANT' });
    const totalJudges = await User.countDocuments({ role: 'JUDGE' });
    const totalPrograms = await Program.countDocuments();
    const totalResults = await Result.countDocuments();

    res.render('admin/dashboard', { 
        layout: 'main', 
        user: req.session.user,
        stats: { totalParticipants, totalJudges, totalPrograms, totalResults },
        success: req.query.success 
    });
});

router.get('/add-result', isAdmin, (req, res) => {
    res.render('admin/add-result', { layout: 'main', user: req.session.user });
});

router.post('/add-result', isAdmin, async (req, res) => {
    try {
        const { programName, category, gender, section, type, firstPlace, secondPlace, thirdPlace } = req.body;
        
        const query = {
            name: { $regex: new RegExp(`^${programName.trim()}$`, 'i') },
            category,
            section
        };
        
        if (category !== 'Team') {
            query.gender = gender;
            query.type = type;
        }

        const programDoc = await Program.findOne(query);
        if (!programDoc) {
            throw new Error(`The program "${programName}" does not exist for this combination.`);
        }

        // Dynamic points rule: 20/15/10 for Team, General, or Group; else 10/5/3
        const isHigherPoints = (programDoc.category === 'Team' || programDoc.section === 'General' || programDoc.type === 'Group');
const p1Points = isHigherPoints ? 20 : 10;
const p2Points = isHigherPoints ? 15 : 5;
const p3Points = isHigherPoints ? 10 : 3;

        const savePlacement = async (chestStr, scorePoints, positionNum) => {
            if (!chestStr || !chestStr.trim()) return;
            const chessArray = chestStr.split(',').map(c => c.trim()).filter(c => c);
            if (chessArray.length === 0) return;

            const { users, team } = await validateResultEntry(programDoc._id, chessArray);

            await Result.create({
                program: programDoc._id,
                participants: users.map(u => u._id), // Save array of users
                team: team,
                score: scorePoints,
                position: positionNum,
                status: 'published'
            });
        };

        await savePlacement(firstPlace, p1Points, 1);
await savePlacement(secondPlace, p2Points, 2);
await savePlacement(thirdPlace, p3Points, 3);

        res.redirect('/admin/dashboard?success=Results Added Successfully');
    } catch (error) {
        res.render('admin/add-result', { layout: 'main', error: error.message });
    }
});

router.get('/results', isAdmin, async (req, res) => {
    const { category, gender, section, type, team, status } = req.query;
    
    let progFilter = {};
    if (category) progFilter.category = category;
    if (gender) progFilter.gender = gender;
    if (section) progFilter.section = section;
    if (type) progFilter.type = type;

    const programs = await Program.find(progFilter);
    const programIds = programs.map(p => p._id);

    let resultFilter = { program: { $in: programIds } };
    if (team) resultFilter.team = team;
    if (status === 'published') resultFilter.status = 'published';
    if (status === 'unpublished' || status === 'draft') resultFilter.status = 'draft';

    const results = await Result.find(resultFilter)
        .populate('program')
        .populate('participants')
        .populate('judgedBy')
        .sort({ createdAt: -1 })
        .lean(); 

    res.render('admin/results', { 
        layout: 'main', 
        user: req.session.user,
        results,
        query: req.query,
        success: req.query.success
    });
});

router.post('/publish-result/:id', isAdmin, async (req, res) => {
    const result = await Result.findById(req.params.id);
    if (result) {
        result.status = result.status === 'published' ? 'draft' : 'published';
        await result.save();
    }
    res.redirect('/admin/results?success=Visibility Updated');
});

router.post('/delete-result/:id', isAdmin, async (req, res) => {
    await Result.findByIdAndDelete(req.params.id);
    res.redirect('/admin/results?success=Result Deleted Successfully');
});

router.get('/users', isAdmin, async (req, res) => {
    const users = await User.find({ role: 'PARTICIPANT' }).sort({ createdAt: -1 }).lean(); 
    res.render('admin/users', { layout: 'main', user: req.session.user, users, success: req.query.success });
});

router.get('/add-user', isAdmin, (req, res) => {
    res.render('admin/add-user', { layout: 'main', user: req.session.user });
});

router.post('/add-user', isAdmin, async (req, res) => {
    try {
        const { name, chessNumber, category, gender, team, password } = req.body;
        const existingUser = await User.findOne({ chessNumber });
        if (existingUser) throw new Error("A participant with this Chess Number already exists.");

        await User.create({ role: 'PARTICIPANT', name, chessNumber, category, gender, team, password });
        res.redirect('/admin/users?success=Participant added successfully');
    } catch (error) {
        res.render('admin/add-user', { layout: 'main', user: req.session.user, error: error.message });
    }
});

router.get('/edit-user/:id', isAdmin, async (req, res) => {
    try {
        const editUser = await User.findById(req.params.id).lean();
        if (!editUser) throw new Error("Participant not found.");
        res.render('admin/edit-user', { layout: 'main', user: req.session.user, editUser });
    } catch (error) {
        res.redirect('/admin/users?error=Participant not found');
    }
});

router.post('/edit-user/:id', isAdmin, async (req, res) => {
    try {
        const { name, chessNumber, category, gender, team, password } = req.body;
        const existingUser = await User.findOne({ chessNumber, _id: { $ne: req.params.id } });
        if (existingUser) throw new Error("This Chess Number is already in use.");

        const userToUpdate = await User.findById(req.params.id);
        userToUpdate.name = name;
        userToUpdate.chessNumber = chessNumber;
        userToUpdate.category = category;
        userToUpdate.gender = gender;
        userToUpdate.team = team;
        if (password && password.trim() !== '') userToUpdate.password = password;

        await userToUpdate.save();
        res.redirect('/admin/users?success=Participant updated successfully');
    } catch (error) {
        const editUser = await User.findById(req.params.id).lean();
        res.render('admin/edit-user', { layout: 'main', user: req.session.user, editUser, error: error.message });
    }
});

router.post('/delete-user/:id', isAdmin, async (req, res) => {
    try {
        await User.findByIdAndDelete(req.params.id);
        res.redirect('/admin/users?success=Participant deleted successfully');
    } catch (error) {
        res.redirect('/admin/users?error=Failed to delete participant');
    }
});

router.get('/judges', isAdmin, async (req, res) => {
    const judges = await User.find({ role: 'JUDGE' }).sort({ createdAt: -1 }).lean();
    res.render('admin/judges', { layout: 'main', user: req.session.user, judges, success: req.query.success, error: req.query.error });
});

router.post('/add-judge', isAdmin, async (req, res) => {
    try {
        const { name, password } = req.body;
        if (!name || !password) throw new Error("Name and password are required.");
        const existingJudge = await User.findOne({ name, role: 'JUDGE' });
        if (existingJudge) throw new Error("A judge with this name already exists.");

        await User.create({ name, role: 'JUDGE', password });
        res.redirect('/admin/judges?success=Judge created successfully');
    } catch (error) {
        res.redirect('/admin/judges?error=' + encodeURIComponent(error.message));
    }
});

router.post('/delete-judge/:id', isAdmin, async (req, res) => {
    try {
        await User.findByIdAndDelete(req.params.id);
        res.redirect('/admin/judges?success=Judge deleted successfully');
    } catch (error) {
        res.redirect('/admin/judges?error=Failed to delete judge');
    }
});

router.get('/programs', isAdmin, async (req, res) => {
    const programs = await Program.find().sort({ category: 1, name: 1 }).lean();
    res.render('admin/programs', { layout: 'main', user: req.session.user, programs, success: req.query.success, error: req.query.error });
});

router.get('/add-program', isAdmin, (req, res) => {
    res.render('admin/add-program', { layout: 'main', user: req.session.user });
});

router.post('/add-program', isAdmin, async (req, res) => {
    try {
        const { name, category, gender, section, type } = req.body;
        await Program.create({
            name,
            category,
            gender: category === 'Team' ? undefined : gender,
            section,
            type: category === 'Team' ? undefined : type
        });
        res.redirect('/admin/programs?success=Program added successfully');
    } catch(error) {
        res.render('admin/add-program', { layout: 'main', user: req.session.user, error: error.message });
    }
});

router.get('/edit-program/:id', isAdmin, async (req, res) => {
    try {
        const editProgram = await Program.findById(req.params.id).lean();
        if (!editProgram) throw new Error("Program not found.");
        res.render('admin/edit-program', { layout: 'main', user: req.session.user, editProgram });
    } catch (error) {
        res.redirect('/admin/programs?error=Program not found');
    }
});

router.post('/edit-program/:id', isAdmin, async (req, res) => {
    try {
        const { name, category, gender, section, type } = req.body;
        const programToUpdate = await Program.findById(req.params.id);
        programToUpdate.name = name;
        programToUpdate.category = category;
        programToUpdate.section = section;
        programToUpdate.gender = category === 'Team' ? undefined : gender;
        programToUpdate.type = category === 'Team' ? undefined : type;

        await programToUpdate.save();
        res.redirect('/admin/programs?success=Program updated successfully');
    } catch (error) {
        const editProgram = await Program.findById(req.params.id).lean();
        res.render('admin/edit-program', { layout: 'main', user: req.session.user, editProgram, error: error.message });
    }
});

router.post('/delete-program/:id', isAdmin, async (req, res) => {
    try {
        await Program.findByIdAndDelete(req.params.id);
        res.redirect('/admin/programs?success=Program deleted successfully');
    } catch (error) {
        res.redirect('/admin/programs?error=Failed to delete program');
    }
});

module.exports = router;