const mongoose = require('mongoose');

const programSchema = new mongoose.Schema({
    name: { type: String, required: true },
    category: { type: String, enum: ['Sub Junior', 'Junior', 'Senior', 'General', 'Team'], required: true },
    gender: { type: String, enum: ['Boys', 'Girls'] }, // Optional for Team
    section: { type: String, enum: ['Main Stage', 'Off Stage'] }, // Optional for Team
    type: { type: String, enum: ['Individual', 'Group'] } // Optional for Team
}, { timestamps: true });

module.exports = mongoose.model('Program', programSchema);