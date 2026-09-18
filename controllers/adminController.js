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
    
    // Count unique programs that have results uploaded
    const resultsCountAgg = await Result.distinct('program');
    const totalResults = resultsCountAgg.length;

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
});

router.post('/add-result', isAdmin, async (req, res) => {
    try {
        const { programId, firstPlace, secondPlace, thirdPlace, action } = req.body;
        
        // Handle draft vs published actions
        const resultStatus = action === 'draft' ? 'draft' : 'published';

        const programDoc = await Program.findById(programId);
        if (!programDoc) {
            throw new Error(`Selected program does not exist.`);
        }

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
                status: resultStatus
            });
        };

        await savePlacement(firstPlace, p1Points, 1);
        await savePlacement(secondPlace, p2Points, 2);
        await savePlacement(thirdPlace, p3Points, 3);

        const successMessage = resultStatus === 'draft' ? 'Result Saved as Draft Successfully' : 'Results Published Successfully';
        res.redirect(`/admin/dashboard?success=${encodeURIComponent(successMessage)}`);
    } catch (error) {
        const programs = await Program.find({}).sort({ name: 1 }).lean();
        res.render('admin/add-result', { layout: 'main', user: req.session.user, programs, error: error.message });
    }
});

router.get('/results', isAdmin, async (req, res) => {
    try {
        const { category, gender, section, type, team, status } = req.query;
        
        let progFilter = {};
        if (category) progFilter.category = category;
        if (gender) progFilter.gender = gender;
        if (section) progFilter.section = section;
        if (type) progFilter.type = type;

        const programs = await Program.find(progFilter).lean();
        const programIds = programs.map(p => p._id);

        let resultFilter = { program: { $in: programIds } };
        if (team) resultFilter.team = team;
        if (status === 'published') resultFilter.status = 'published';
        if (status === 'unpublished' || status === 'draft') resultFilter.status = 'draft';

        const rawResults = await Result.find(resultFilter)
            .populate('program')
            .populate('participants')
            .populate('judgedBy')
            .sort({ createdAt: -1 })
            .lean(); 

        const programMap = {};
        rawResults.forEach(resItem => {
            if (!resItem.program) return;
            const progId = resItem.program._id.toString();

            if (!programMap[progId]) {
                programMap[progId] = {
                    _id: resItem._id.toString(),
                    program: resItem.program,
                    placements: [],
                    status: resItem.status
                };
            }

            programMap[progId].placements.push({
                position: resItem.position,
                score: resItem.score,
                team: resItem.team,
                participants: resItem.participants
            });
        });

        const groupedResults = Object.values(programMap).map(item => {
            item.placements.sort((a, b) => a.position - b.position);
            return item;
        });

        res.render('admin/results', { 
            layout: 'main', 
            user: req.session.user,
            results: groupedResults,
            query: req.query,
            success: req.query.success
        });
    } catch (err) {
        res.status(500).send('Error loading results: ' + err.message);
    }
});

router.post('/publish-result/:id', isAdmin, async (req, res) => {
    try {
        const targetResult = await Result.findById(req.params.id);
        if (targetResult) {
            const newStatus = targetResult.status === 'published' ? 'draft' : 'published';
            await Result.updateMany({ program: targetResult.program }, { status: newStatus });
        }
        res.redirect('/admin/results?success=Visibility Updated');
    } catch (err) {
        res.redirect('/admin/results?error=Failed to update visibility');
    }
});

router.post('/delete-result/:id', isAdmin, async (req, res) => {
    try {
        const targetResult = await Result.findById(req.params.id);
        if (targetResult) {
            await Result.deleteMany({ program: targetResult.program });
        }
        res.redirect('/admin/results?success=Program Results Deleted Successfully');
    } catch (err) {
        res.redirect('/admin/results?error=Failed to delete results');
    }
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