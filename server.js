// server.js
const express = require('express');
const { engine } = require('express-handlebars');
const mongoose = require('mongoose');
const session = require('express-session');
const bcrypt = require('bcrypt'); // Required for hashing the admin password

const app = express();

// 1. ESSENTIAL MIDDLEWARE (Must be at the very top so req.body works)
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static('public'));

// 2. SESSION SETUP
app.use(session({
    secret: 'filhal-fest-super-secret-key',
    resave: true,
    saveUninitialized: true,
    cookie: { maxAge: 1000 * 60 * 60 * 24 * 7 } // 7 Days persistence
}));

// 3. SERVER BOOT ID & GLOBAL LOCALS
const serverBootId = Date.now().toString();

app.use((req, res, next) => {
    res.locals.serverBootId = serverBootId;
    res.locals.participant = req.session.participant || null;
    res.locals.admin = req.session.admin || null;
    res.locals.judge = req.session.judge || null; // <--- Added for Judge Header navigation
    res.locals.user = req.session.user || null; 
    next();
});

// 4. DATABASE CONNECTION
const dbURI = process.env.MONGO_URI || 'mongodb+srv://newww:nasir123@cluster1011.ir2agix.mongodb.net/filhalfest?appName=Cluster1011';

mongoose.connect(dbURI)
    .then(() => console.log('Connected to MongoDB'))
    .catch(err => console.error('Database connection error:', err));

// 5. HANDLEBARS SETUP
app.engine('.hbs', engine({
    extname: '.hbs',
    helpers: {
        eq: (v1, v2) => v1 === v2,
        lookup: (obj, field) => (obj && obj[field]) ? obj[field] : 0, // <--- Added lookup helper
        formatProgram: (prog) => `${prog.name} — ${prog.category} — ${prog.gender || 'N/A'} — ${prog.section || 'N/A'} — ${prog.type || 'N/A'}`,
        isWinner: (pos) => pos === 1,
        isPodium: (pos) => pos <= 3,
        pluckJoin: (array, key) => array.map(item => item[key]).join(', '),
    }
}));
app.set('view engine', '.hbs');

// 6. TEMPORARY ROUTE TO CREATE ADMIN
app.get('/create-admin', async (req, res) => {
    try {
        const User = require('./models/User'); 
        await User.deleteMany({ role: 'ADMIN' });

        await User.create({
            name: 'Administrator',
            role: 'ADMIN',
            password: 'nasir123' 
        });
        
        res.send('Admin user created successfully with role ADMIN!');
    } catch (err) {
        res.status(500).send('Error: ' + err.message);
    }
});

// 7. CONTROLLER ROUTES (Registered AFTER body parser middleware)
const judgeController = require('./controllers/judgeController');

app.get('/judge/login', judgeController.getLogin);
app.post('/judge/login', judgeController.postLogin);
app.get('/judge/dashboard', judgeController.getDashboard);
app.post('/judge/submit-result', judgeController.submitResult);
app.get('/judge/logout', judgeController.logout);
app.get('/judge/results', judgeController.getMyResults);
app.get('/judge/edit-result/:id', judgeController.getEditResult);
app.post('/judge/edit-result/:id', judgeController.postEditResult);

app.use('/', require('./controllers/publicController'));
app.use('/admin', require('./controllers/adminController'));
app.use('/participant', require('./controllers/participantController'));

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => console.log(`Filhal Fest Server running on port ${PORT}`));