require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const cors = require('cors');
const { Client, GatewayIntentBits } = require('discord.js');

const app = express();
app.use(express.json());
app.use(cors({ origin: 'http://localhost:5500' })); // Adjust for your frontend port

// MongoDB Connection
mongoose.connect(process.env.MONGODB_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true
}).then(() => console.log('Connected to MongoDB'))
  .catch(err => console.error('MongoDB connection error:', err));

// Schemas
const userSchema = new mongoose.Schema({
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    bots: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Bot' }]
});
const User = mongoose.model('User', userSchema);

const botSchema = new mongoose.Schema({
    name: String,
    prefix: String,
    commandType: String,
    token: String,
    owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    createdAt: { type: Date, default: Date.now }
});
const Bot = mongoose.model('Bot', botSchema);

// Bot Manager
class BotManager {
    constructor() {
        this.bots = new Map();
    }

    async startBot(botData) {
        const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages] });
        
        client.on('ready', () => console.log(`${botData.name} is online!`));
        client.on('messageCreate', message => {
            if (!message.content.startsWith(botData.prefix)) return;
            const args = message.content.slice(botData.prefix.length).trim().split(/ +/);
            const command = args.shift().toLowerCase();
            message.reply(`I'm a ${botData.commandType} bot! Command: ${command}`);
        });

        try {
            await client.login(botData.token);
            this.bots.set(botData._id.toString(), client);
        } catch (error) {
            console.error('Bot login error:', error);
        }
    }
}

const botManager = new BotManager();

// Auth Middleware
const authMiddleware = async (req, res, next) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'No token provided' });

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.user = await User.findById(decoded.id);
        if (!req.user) throw new Error('User not found');
        next();
    } catch (error) {
        res.status(401).json({ error: 'Invalid token' });
    }
};

// Routes
app.post('/api/register', async (req, res) => {
    try {
        const { email, password } = req.body;
        const hashedPassword = await bcrypt.hash(password, 10);
        const user = new User({ email, password: hashedPassword });
        await user.save();
        res.status(201).json({ message: 'User registered' });
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

app.post('/api/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        const user = await User.findOne({ email });
        if (!user || !await bcrypt.compare(password, user.password)) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }
        const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: '1d' });
        res.json({ token });
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

app.post('/api/create-bot', authMiddleware, async (req, res) => {
    try {
        const { name, prefix, commandType } = req.body;
        const token = `BOT_${Math.random().toString(36).substr(2)}`; // Simulated token
        
        const bot = new Bot({
            name,
            prefix,
            commandType,
            token,
            owner: req.user._id
        });
        
        await bot.save();
        await User.findByIdAndUpdate(req.user._id, { $push: { bots: bot._id } });
        await botManager.startBot(bot);
        
        res.status(201).json({ botId: bot._id, token });
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
