const Result = require('../models/Result');
const Program = require('../models/Program');

async function calculateTeamScores() {
    try {
        // Aggregate published results with program and participant details
        const results = await Result.find({ status: 'published' })
            .populate('program')
            .populate('participants')
            .lean();

        const scores = {
            Hermos: {
                total: 0,
                boys: { "Sub Junior": 0, "Junior": 0, "Senior": 0, "General": 0, total: 0 },
                girls: { "Sub Junior": 0, "Junior": 0, "Senior": 0, "General": 0, total: 0 }
            },
            Gibraltar: {
                total: 0,
                boys: { "Sub Junior": 0, "Junior": 0, "Senior": 0, "General": 0, total: 0 },
                girls: { "Sub Junior": 0, "Junior": 0, "Senior": 0, "General": 0, total: 0 }
            }
        };

        results.forEach(result => {
            const team = result.team;
            const score = result.score || 0;
            const program = result.program;

            if (!scores[team] || !program) return;

            // Add to total team points
            scores[team].total += score;

            // Determine category and gender breakdown
            const category = program.category; // e.g. "Sub Junior", "Junior", "Senior", "General", "Team"
            
            // Check participant gender or program gender fallback
            let gender = program.gender;
            if (!gender && result.participants && result.participants.length > 0) {
                gender = result.participants[0].gender; // "Boys" or "Girls"
            }

            // Map into boys/girls breakdown objects
            if (gender === 'Boys' && scores[team].boys[category] !== undefined) {
                scores[team].boys[category] += score;
                scores[team].boys.total += score;
            } else if (gender === 'Girls' && scores[team].girls[category] !== undefined) {
                scores[team].girls[category] += score;
                scores[team].girls.total += score;
            } else if (category === 'General' || category === 'Team') {
                // If it's a General or Team event without strict gender separation, add to both or handle accordingly
                scores[team].boys.General += score;
                scores[team].boys.total += score;
            }
        });

        // Determine Champion
        let champion = "DRAW";
        if (scores.Hermos.total > scores.Gibraltar.total) {
            champion = "Hermos";
        } else if (scores.Gibraltar.total > scores.Hermos.total) {
            champion = "Gibraltar";
        }

        return { scores, champion };
    } catch (err) {
        console.error("Error calculating team scores:", err);
        return {
            scores: { 
                Hermos: { total: 0, boys: { total: 0 }, girls: { total: 0 } }, 
                Gibraltar: { total: 0, boys: { total: 0 }, girls: { total: 0 } } 
            },
            champion: "DRAW"
        };
    }
}

module.exports = { calculateTeamScores };