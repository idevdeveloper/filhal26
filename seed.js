const mongoose = require('mongoose');
const User = require('./models/User');
const Program = require('./models/Program');

mongoose.connect('mongodb://127.0.0.1:27017/filhalfest');
async function seedDatabase() {
    console.log("Clearing old data...");
    await User.deleteMany({});
    await Program.deleteMany({});

    console.log("Creating Admin...");
    await User.create({
        role: 'ADMIN',
        name: 'admin',
        password: 'password123'
    });

    console.log("Creating Participants (Rule 39)...");
    const participants = [
        { role: 'PARTICIPANT', name: 'Ahmed', chessNumber: '101', category: 'Senior', gender: 'Boys', team: 'Hermos', password: 'password123' },
        { role: 'PARTICIPANT', name: 'Rahman', chessNumber: '102', category: 'Senior', gender: 'Boys', team: 'Gibraltar', password: 'password123' },
        { role: 'PARTICIPANT', name: 'Aisha', chessNumber: '201', category: 'Junior', gender: 'Girls', team: 'Hermos', password: 'password123' },
        { role: 'PARTICIPANT', name: 'Fathima', chessNumber: '202', category: 'Sub Junior', gender: 'Girls', team: 'Gibraltar', password: 'password123' }
    ];
    await User.create(participants);

    console.log("Creating Programs (Rule 39)...");
    const programs = [
        { name: 'Single Song', category: 'Senior', gender: 'Boys', section: 'Main Stage', type: 'Individual' },
        { name: 'Single Song', category: 'Junior', gender: 'Girls', section: 'Main Stage', type: 'Individual' },
        { name: 'Speech', category: 'Senior', gender: 'Boys', section: 'Off Stage', type: 'Individual' },
        { name: 'Group Drama', category: 'Senior', gender: 'Boys', section: 'Main Stage', type: 'Group' },
        { name: 'General Quiz', category: 'General', gender: 'Boys', section: 'Off Stage', type: 'Individual' },
        { name: 'Team Debate', category: 'Team', section: 'Main Stage', type: 'Group' } // Team overrides gender requirement
    ];
    await Program.insertMany(programs);

    console.log("Seed complete! You can now log in.");
    process.exit();
}

seedDatabase();