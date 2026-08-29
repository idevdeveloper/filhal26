// server.js
const express = require('express');
const { engine } = require('express-handlebars');
const mongoose = require('mongoose');
const session = require('express-session');
const bcrypt = require('bcrypt'); // Required for hashing the admin password
const multer = require('multer'); // <--- Added for photo file uploads
const path = require('path');
const fs = require('fs');
const sharp = require('sharp'); // <--- Added for image resizing (1080x1350)
const Photo = require('./models/Photo'); // <--- Added Photo Model

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

// 3. MULTER STORAGE CONFIGURATION FOR UPLOADS
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, 'public/uploads'); // Saves files into public/uploads folder
    },
    filename: (req, file, cb) => {
        cb(null, Date.now() + path.extname(file.originalname)); // Unique filename
    }
});
const upload = multer({ storage: storage });

// 4. SERVER BOOT ID & GLOBAL LOCALS
const serverBootId = Date.now().toString();

app.use((req, res, next) => {
    res.locals.serverBootId = serverBootId;
    res.locals.participant = req.session.participant || null;
    res.locals.admin = req.session.admin || null;
    res.locals.judge = req.session.judge || null; 
    res.locals.user = req.session.user || null; 
    next();
});

// 5. DATABASE CONNECTION
const dbURI = process.env.MONGO_URI || 'mongodb+srv://newww:nasir123@cluster1011.ir2agix.mongodb.net/filhalfest?appName=Cluster1011';

mongoose.connect(dbURI)
    .then(() => console.log('Connected to MongoDB'))
    .catch(err => console.error('Database connection error:', err));

// 6. HANDLEBARS SETUP
app.engine('.hbs', engine({
    extname: '.hbs',
    helpers: {
        eq: (v1, v2) => v1 === v2,
        lookup: (obj, field) => (obj && obj[field]) ? obj[field] : 0, 
        formatProgram: (prog) => `${prog.name} — ${prog.category} — ${prog.gender || 'N/A'} — ${prog.section || 'N/A'} — ${prog.type || 'N/A'}`,
        isWinner: (pos) => pos === 1,
        isPodium: (pos) => pos <= 3,
        pluckJoin: (array, key) => array.map(item => item[key]).join(', '),
        includes: (array, value) => {
            if (!array) return false;
            return array.map(String).includes(String(value));
        }
    }
}));
app.set('view engine', '.hbs');

// 7. TEMPORARY ROUTE TO CREATE ADMIN
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

// 8. PHOTO UPLOAD, MANAGEMENT & GALLERY ROUTES
// Admin Upload Page View (maps to your existing views/admin-upload-photo.hbs)
app.get('/admin/photos/upload', (req, res) => {
    if (!res.locals.admin) return res.redirect('/admin/login');
    res.render('admin-upload-photo'); 
});

// Admin Media Management Dashboard (maps to views/admin-manage.hbs for listing and deleting)
app.get('/admin/photos/manage', async (req, res) => {
    if (!res.locals.admin) return res.redirect('/admin/login');
    try {
        const photos = await Photo.find().sort({ createdAt: -1 }).lean();
        res.render('admin-manage', { photos }); 
    } catch (err) {
        res.status(500).send('Error loading media management: ' + err.message);
    }
});

// Admin Post Upload Handler with automatic 1080x1350 resizing using Sharp (and optional title)
app.post('/admin/photos/upload', upload.single('photo'), async (req, res) => {
    if (!res.locals.admin) return res.status(403).send('Unauthorized');
    try {
        if (!req.file) return res.status(400).send('No file uploaded.');
        
        const filename = `resized-${Date.now()}.jpg`;
        const outputPath = path.join(__dirname, 'public', 'uploads', filename);

        // Process image with sharp: resize to exact 1080x1350 dimensions
        await sharp(req.file.path)
            .resize(1080, 1350, {
                fit: 'cover',
                position: 'center'
            })
            .jpeg({ quality: 90 })
            .toFile(outputPath);

        // Clean up original temporary file uploaded by multer
        if (fs.existsSync(req.file.path)) {
            fs.unlinkSync(req.file.path);
        }

        // Save reference to database (title is optional)
        await Photo.create({
            title: req.body.title ? req.body.title.trim() : '',
            imageUrl: `/uploads/${filename}`
        });

        res.redirect('/admin/photos/manage');
    } catch (err) {
        res.status(500).send('Error processing and saving photo: ' + err.message);
    }
});

// Admin Delete Photo Handler
app.post('/admin/photos/delete/:id', async (req, res) => {
    if (!res.locals.admin) return res.status(403).send('Unauthorized');
    try {
        const photo = await Photo.findById(req.params.id);
        if (photo) {
            const filePath = path.join(__dirname, 'public', photo.imageUrl);
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
            }
            await Photo.findByIdAndDelete(req.params.id);
        }

        res.redirect('/admin/photos/manage');
    } catch (err) {
        res.status(500).send('Error deleting photo: ' + err.message);
    }
});

// User Gallery Page View
app.get('/gallery', async (req, res) => {
    try {
        const photos = await Photo.find().sort({ createdAt: -1 }).lean();
        res.render('gallery', { photos }); 
    } catch (err) {
        res.status(500).send('Error loading gallery: ' + err.message);
    }
});

// 9. CONTROLLER ROUTES (Registered AFTER body parser middleware)
const judgeController = require('./controllers/judgeController');

app.get('/judge/login', judgeController.getLogin);
app.post('/judge/login', judgeController.postLogin);
app.get('/judge/dashboard', judgeController.getDashboard);
app.get('/judge/api/program-participants/:programId', judgeController.getProgramParticipants);
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