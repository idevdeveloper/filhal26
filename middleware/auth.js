// middleware/auth.js

const requireAdmin = (req, res, next) => {
    // If an admin session exists, let them through
    if (req.session && req.session.admin) {
        return next();
    }
    // If a participant is trying to access an admin route, bounce them back to their dashboard
    if (req.session && req.session.participant) {
        return res.redirect('/participant/dashboard');
    }
    // Otherwise, redirect to admin login
    return res.redirect('/admin/login');
};

const requireParticipant = (req, res, next) => {
    // If a participant session exists, let them through
    if (req.session && req.session.participant) {
        return next();
    }
    // If an admin is trying to access a participant route, bounce them back to the admin panel
    if (req.session && req.session.admin) {
        return res.redirect('/admin/dashboard');
    }
    // Otherwise, redirect to participant login
    return res.redirect('/login');
};

module.exports = {
    requireAdmin,
    requireParticipant
};