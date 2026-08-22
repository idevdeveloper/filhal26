const express = require('express');
const router = express.Router();
const Result = require('../models/Result');
const bcrypt = require('bcryptjs');
const User = require('../models/User');

const isParticipant = (req, res, next) => req.session.participant ? next() : res.redirect('/login');

router.get('/dashboard', isParticipant, async (req, res) => {
    const participant = req.session.participant;
    
    const myResults = await Result.find({ participants: participant._id, status: 'published' })
        .populate('program')
        .sort({ createdAt: -1 })
        .lean(); 

    let totalScore = 0;
    let programCount = myResults.length;

    myResults.forEach(r => {
        // ONLY add to personal total score if it is strictly an Individual program type
        if (r.program && r.program.type === 'Individual' && r.program.category !== 'General') {
            totalScore += r.score;
        }
    });

    res.render('participant/dashboard', { 
        layout: 'main', 
        user: participant,
        myResults,
        stats: { totalScore, programCount }
    });
});

router.get('/change-password', isParticipant, (req, res) => {
    res.render('participant/change-password', { layout: 'main', user: req.session.user });
});

router.post('/change-password', isParticipant, async (req, res) => {
    try {
        const { currentPassword, newPassword, confirmPassword } = req.body;

        if (newPassword !== confirmPassword) throw new Error("New passwords do not match.");
        if (newPassword.length < 6) throw new Error("Password must be at least 6 characters long.");

        const userRecord = await User.findById(req.session.participant._id);
        const isMatch = await bcrypt.compare(currentPassword, userRecord.password);
        if (!isMatch) throw new Error("Incorrect current password.");

        userRecord.password = newPassword;
        await userRecord.save();

        res.render('participant/change-password', { 
            layout: 'main', 
            user: req.session.participant, 
            success: "Password updated successfully!" 
        });
    } catch (error) {
        res.render('participant/change-password', { 
            layout: 'main', 
            user: req.session.participant, 
            error: error.message 
        });
    }
});

module.exports = router;