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

router.get('/add-result', isAdmin, async (req, res) => {
    const programs = await Program.find({}).sort({ name: 1 }).lean();
    res.render('admin/add-result', { layout: 'main', user: req.session.user, programs });
});

router.get('/api/program-participants/:programId', isAdmin, async (req, res) => {
    try {
        const program = await Program.findById(req.params.programId).lean();
        if (!program) return res.status(404).json({ error: 'Program not found' });

        const participants = await User.find({ 
            role: 'PARTICIPANT', 
            programs: req.params.programId 
        }).lean();

        if (program.type === 'Group') {
            // Group logic: Group participants by their team to form logical group choices
            const groupsByTeam = {};
            participants.forEach(p => {
                if (!groupsByTeam[p.team]) groupsByTeam[p.team] = [];
                groupsByTeam[p.team].push(p);
            });

            const groupOptions = [];
            Object.keys(groupsByTeam).forEach(teamName => {
                const teamMembers = groupsByTeam[teamName];
                // Create chunks or teams as group options if they have multiple members
                if (teamMembers.length > 0) {
                    groupOptions.push({
                        isGroup: true,
                        team: teamName,
                        // Combine participant IDs as a comma-separated string value for form submission
                        ids: teamMembers.map(m => m._id.toString()).join(','),
                        displayString: `${teamName} Team Group (${teamMembers.length} members: ${teamMembers.map(m => m.name).join(', ')})`
                    });
                }
            });
            return res.json({ isGroup: true, options: groupOptions });
        } else {
            res.json({ isGroup: false, options: participants });
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.post('/add-result', isAdmin, async (req, res) => {
    try {
        const { programId, firstPlace, secondPlace, thirdPlace } = req.body;
        
        const programDoc = await Program.findById(programId);
        if (!programDoc) {
            throw new Error(`Selected program does not exist.`);
        }

        const isHigherPoints = (programDoc.category === 'Team' || programDoc.section === 'General' || programDoc.type === 'Group');
        const p1Points = isHigherPoints ? 20 : 10;
        const p2Points = isHigherPoints ? 15 : 7;
        const p3Points = isHigherPoints ? 10 : 5;

        const savePlacement = async (selectedVal, scorePoints, positionNum) => {
            if (!selectedVal || !selectedVal.trim()) return;

            let participantIds = [];
            let teamName = '';

            if (programDoc.type === 'Group') {
                // selectedVal contains comma-separated IDs from the group option
                participantIds = selectedVal.split(',').map(id => id.trim()).filter(id => id);
                const firstUser = await User.findById(participantIds[0]);
                if (!firstUser) throw new Error(`Invalid group participants selected.`);
                teamName = firstUser.team;
            } else {
                const userDoc = await User.findOne({ _id: selectedVal, role: 'PARTICIPANT' });
                if (!userDoc) throw new Error(`Selected participant not found.`);
                participantIds = [userDoc._id];
                teamName = userDoc.team;
            }

            await Result.create({
                program: programDoc._id,
                participants: participantIds,
                team: teamName,
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
        const programs = await Program.find({}).sort({ name: 1 }).lean();
        res.render('admin/add-result', { layout: 'main', user: req.session.user, programs, error: error.message });
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
    const users = await User.find({ role: 'PARTICIPANT' }).populate('programs').sort({ createdAt: -1 }).lean(); 
    res.render('admin/users', { layout: 'main', user: req.session.user, users, success: req.query.success });
});

router.get('/add-user', isAdmin, async (req, res) => {
    const programs = await Program.find({}).sort({ name: 1 }).lean();
    res.render('admin/add-user', { layout: 'main', user: req.session.user, programs });
});

router.post('/add-user', isAdmin, async (req, res) => {
    try {
        const { name, chessNumber, category, gender, team, password, programs } = req.body;
        const existingUser = await User.findOne({ chessNumber });
        if (existingUser) throw new Error("A participant with this Chess Number already exists.");

        await User.create({ 
            role: 'PARTICIPANT', 
            name, 
            chessNumber, 
            category, 
            gender, 
            team, 
            password,
            programs: Array.isArray(programs) ? programs : (programs ? [programs] : [])
        });
        res.redirect('/admin/users?success=Participant added successfully');
    } catch (error) {
        const programs = await Program.find({}).sort({ name: 1 }).lean();
        res.render('admin/add-user', { layout: 'main', user: req.session.user, programs, error: error.message });
    }
});

router.get('/edit-user/:id', isAdmin, async (req, res) => {
    try {
        const editUserDoc = await User.findById(req.params.id).lean();
        if (!editUserDoc) throw new Error("Participant not found.");
        
        // Map assigned program IDs to strings for easy lookup in Handlebars
        const editUser = {
            ...editUserDoc,
            programs: editUserDoc.programs ? editUserDoc.programs.map(p => p.toString()) : []
        };

        const programs = await Program.find({}).sort({ name: 1 }).lean();
        res.render('admin/edit-user', { layout: 'main', user: req.session.user, editUser, programs });
    } catch (error) {
        res.redirect('/admin/users?error=Participant not found');
    }
});

router.post('/edit-user/:id', isAdmin, async (req, res) => {
    try {
        const { name, chessNumber, category, gender, team, password, programs } = req.body;
        const existingUser = await User.findOne({ chessNumber, _id: { $ne: req.params.id } });
        if (existingUser) throw new Error("This Chess Number is already in use.");

        const userToUpdate = await User.findById(req.params.id);
        userToUpdate.name = name;
        userToUpdate.chessNumber = chessNumber;
        userToUpdate.category = category;
        userToUpdate.gender = gender;
        userToUpdate.team = team;
        userToUpdate.programs = Array.isArray(programs) ? programs : (programs ? [programs] : []);
        if (password && password.trim() !== '') userToUpdate.password = password;

        await userToUpdate.save();
        res.redirect('/admin/users?success=Participant updated successfully');
    } catch (error) {
        const editUserDoc = await User.findById(req.params.id).lean();
        const editUser = {
            ...editUserDoc,
            programs: editUserDoc.programs ? editUserDoc.programs.map(p => p.toString()) : []
        };
        const programs = await Program.find({}).sort({ name: 1 }).lean();
        res.render('admin/edit-user', { layout: 'main', user: req.session.user, editUser, programs, error: error.message });
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