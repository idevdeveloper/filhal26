const mongoose = require('mongoose');

const photoSchema = new mongoose.Schema({
    title: { 
        type: String, 
        required: false 
    },
    imageUrl: { 
        type: String, 
        required: true 
    },
    gender: {
        type: String,
        enum: ['boys', 'girls'],
        default: 'boys'
    },
    orientation: {
        type: String,
        enum: ['portrait', 'landscape'],
        default: 'portrait'
    },
    createdAt: { 
        type: Date, 
        default: Date.now 
    }
});

module.exports = mongoose.model('Photo', photoSchema);