// server.js
require('dotenv').config();
const express = require('express');
const { engine } = require('express-handlebars');
const mongoose = require('mongoose');
const session = require('express-session');
const bcrypt = require('bcrypt');
const multer = require('multer');
const path = require('path');
const cloudinary = require('cloudinary').v2;
const Photo = require('./models/Photo');

const app = express();

// 1. ESSENTIAL MIDDLEWARE
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static('public'));

// 2. SESSION SETUP
app.use(session({
    secret: 'filhal-fest-super-secret-key',
    resave: true,
    saveUninitialized: true,
    cookie: { maxAge: 1000 * 60 * 60 * 24 * 7 }
}));

// 3. CLOUDINARY CONFIGURATION
cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
});

// 4. MULTER MEMORY STORAGE
const upload = multer({ storage: multer.memoryStorage() });

// 5. SERVER BOOT ID & GLOBAL LOCALS
const serverBootId = Date.now().toString();

app.use((req, res, next) => {
    res.locals.serverBootId = serverBootId;
    res.locals.participant = req.session.participant || null;
    res.locals.admin = req.session.admin || null;
    res.locals.judge = req.session.judge || null; 
    res.locals.user = req.session.user || null; 
    next();
});

// 6. DATABASE CONNECTION
const dbURI = process.env.MONGO_URI || 'mongodb+srv://newww:nasir123@cluster1011.ir2agix.mongodb.net/filhalfest?appName=Cluster1011';

mongoose.connect(dbURI)
    .then(() => console.log('Connected to MongoDB'))
    .catch(err => console.error('Database connection error:', err));

// 7. HANDLEBARS SETUP
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
        },
        getFramePath: (gender, orientation) => `/images/frame-${gender || 'boys'}-${orientation || 'portrait'}.png`,
        getAspectClass: (orientation) => orientation === 'landscape' ? 'aspect-[4/3]' : 'aspect-[1080/1350]'
    }
}));
app.set('view engine', '.hbs');

// 8. TEMPORARY ROUTE TO CREATE ADMIN
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

// 9. PHOTO UPLOAD, MANAGEMENT & GALLERY ROUTES
app.get('/admin/photos/upload', (req, res) => {
    if (!res.locals.admin) return res.redirect('/admin/login');
    res.render('admin-upload-photo'); 
});

app.get('/admin/photos/manage', async (req, res) => {
    if (!res.locals.admin) return res.redirect('/admin/login');
    try {
        const photos = await Photo.find().sort({ createdAt: -1 }).lean();
        res.render('admin-manage', { photos }); 
    } catch (err) {
        res.status(500).send('Error loading media management: ' + err.message);
    }
});

// Multiple Upload Handler with 1080x1350 (Portrait) and 1536x1152 (Landscape) Dimensions
app.post('/admin/photos/upload', upload.array('photo', 20), async (req, res) => {
    if (!res.locals.admin) return res.status(403).send('Unauthorized');
    try {
        if (!req.files || req.files.length === 0) return res.status(400).send('No files uploaded.');

        const gender = req.body.gender || 'boys';
        const orientation = req.body.orientation || 'portrait';

        // Set dimensions: 1080x1350 for portrait, 1536x1152 for landscape
        const width = orientation === 'landscape' ? 1536 : 1080;
        const height = orientation === 'landscape' ? 1152 : 1350;

        for (const file of req.files) {
            const uploadPromise = new Promise((resolve, reject) => {
                const stream = cloudinary.uploader.upload_stream(
                    {
                        folder: 'filhal-fest',
                        allowed_formats: ['jpg', 'jpeg', 'png', 'webp', 'heic', 'heif'],
                        transformation: [{ width, height, crop: 'fill', gravity: 'center' }]
                    },
                    (error, result) => {
                        if (error) reject(error);
                        else resolve(result);
                    }
                );
                stream.end(file.buffer);
            });

            const result = await uploadPromise;

            await Photo.create({
                title: req.body.title ? req.body.title.trim() : '',
                imageUrl: result.secure_url,
                gender,
                orientation
            });
        }

        res.redirect('/admin/photos/manage');
    } catch (err) {
        res.status(500).send('Error saving photos to cloud: ' + err.message);
    }
});

// Admin Delete Single Photo Handler
app.post('/admin/photos/delete/:id', async (req, res) => {
    if (!res.locals.admin) return res.status(403).send('Unauthorized');
    try {
        await Photo.findByIdAndDelete(req.params.id);
        res.redirect('/admin/photos/manage');
    } catch (err) {
        res.status(500).send('Error deleting photo: ' + err.message);
    }
});

// Admin Clear All Photos Handler
app.post('/admin/photos/clear-all', async (req, res) => {
    if (!res.locals.admin) return res.status(403).send('Unauthorized');
    try {
        await Photo.deleteMany({});
        res.redirect('/admin/photos/manage');
    } catch (err) {
        res.status(500).send('Error clearing photos: ' + err.message);
    }
});

app.get('/gallery', async (req, res) => {
    try {
        const photos = await Photo.find().sort({ createdAt: -1 }).lean();
        res.render('gallery', { photos }); 
    } catch (err) {
        res.status(500).send('Error loading gallery: ' + err.message);
    }
});

// 10. CONTROLLER ROUTES
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