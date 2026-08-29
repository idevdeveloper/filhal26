const mongoose = require('mongoose');

const photoSchema = new mongoose.Schema({
    title: { 
        type: String, 
        required: false // <--- Title is now optional
    },
    imageUrl: { 
        type: String, 
        required: true 
    },
    createdAt: { 
        type: Date, 
        default: Date.now 
    }
});

module.exports = mongoose.model('Photo', photoSchema);