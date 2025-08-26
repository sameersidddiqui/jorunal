const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// MongoDB Connection
const uri = "mongodb+srv://2023bcs033:hJy5VViYhzJGjHCT@sameer.csbsaaf.mongodb.net/?retryWrites=true&w=majority&appName=Sameer";
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});

// JWT Secret
const JWT_SECRET = 'your-jwt-secret-key'; // Change this to a secure secret in production

// Connect to MongoDB
let db, usersCollection, entriesCollection;

async function connectDB() {
  try {
    await client.connect();
    db = client.db('journalApp');
    usersCollection = db.collection('users');
    entriesCollection = db.collection('entries');
    console.log('Connected to MongoDB');
  } catch (error) {
    console.error('MongoDB connection error:', error);
  }
}

connectDB();

// Authentication middleware
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ message: 'Access token required' });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ message: 'Invalid or expired token' });
    }
    req.user = user;
    next();
  });
};

// Routes

// Register new user
app.post('/api/register', async (req, res) => {
  try {
    const { username, password } = req.body;

    // Check if user already exists
    const existingUser = await usersCollection.findOne({ username });
    if (existingUser) {
      return res.status(400).json({ message: 'Username already exists' });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create user
    const result = await usersCollection.insertOne({
      username,
      password: hashedPassword,
      createdAt: new Date()
    });

    res.status(201).json({ message: 'User created successfully' });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Login user
app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    // Find user
    const user = await usersCollection.findOne({ username });
    if (!user) {
      return res.status(400).json({ message: 'Invalid credentials' });
    }

    // Check password
    const isValidPassword = await bcrypt.compare(password, user.password);
    if (!isValidPassword) {
      return res.status(400).json({ message: 'Invalid credentials' });
    }

    // Generate JWT token
    const token = jwt.sign(
      { userId: user._id.toString(), username: user.username },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({
      message: 'Login successful',
      token,
      user: { id: user._id, username: user.username }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Verify token
app.get('/api/verify-token', authenticateToken, (req, res) => {
  res.json({ valid: true, user: req.user });
});

// Get entry for a specific date
app.get('/api/entries/:date', authenticateToken, async (req, res) => {
  try {
    const { date } = req.params;
    const entry = await entriesCollection.findOne({
      userId: req.user.userId,
      date
    });

    res.json({ entry: entry ? entry.content : '' });
  } catch (error) {
    console.error('Get entry error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Save entry
app.post('/api/entries', authenticateToken, async (req, res) => {
  try {
    const { date, content } = req.body;

    // Check if entry already exists
    const existingEntry = await entriesCollection.findOne({
      userId: req.user.userId,
      date
    });

    if (existingEntry) {
      // Update existing entry
      await entriesCollection.updateOne(
        { userId: req.user.userId, date },
        { $set: { content, updatedAt: new Date() } }
      );
    } else {
      // Create new entry
      await entriesCollection.insertOne({
        userId: req.user.userId,
        date,
        content,
        createdAt: new Date(),
        updatedAt: new Date()
      });
    }

    res.json({ message: 'Entry saved successfully' });
  } catch (error) {
    console.error('Save entry error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Get statistics
app.get('/api/statistics', authenticateToken, async (req, res) => {
  try {
    // Get all entries for the user
    const entries = await entriesCollection
      .find({ userId: req.user.userId })
      .sort({ date: 1 })
      .toArray();

    const entryDates = entries.map(entry => entry.date).sort();

    // Group entries by month
    const entriesByMonth = {};
    entries.forEach(entry => {
      const [year, month] = entry.date.split('-');
      const monthYear = `${year}-${month}`;
      entriesByMonth[monthYear] = (entriesByMonth[monthYear] || 0) + 1;
    });

    // Group entries by week (simplified)
    const entriesByWeek = {};
    entries.forEach(entry => {
      const date = new Date(entry.date);
      const week = getWeekNumber(date);
      const weekYear = `${date.getFullYear()}-W${week}`;
      entriesByWeek[weekYear] = (entriesByWeek[weekYear] || 0) + 1;
    });

    // Count entries by weekday
    const weekdayData = [0, 0, 0, 0, 0, 0, 0]; // Sun to Sat
    entries.forEach(entry => {
      const date = new Date(entry.date);
      weekdayData[date.getDay()]++;
    });

    res.json({
      entryDates,
      entriesByMonth,
      entriesByWeek,
      weekdayData
    });
  } catch (error) {
    console.error('Statistics error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Export entries
app.get('/api/export', authenticateToken, async (req, res) => {
  try {
    const { startDate, endDate, includeEmpty } = req.query;

    // Get entries in date range
    const entries = await entriesCollection
      .find({
        userId: req.user.userId,
        date: { $gte: startDate, $lte: endDate }
      })
      .sort({ date: 1 })
      .toArray();

    // Create export data structure
    const exportData = {
      metadata: {
        exportDate: new Date().toISOString(),
        dateRange: { start: startDate, end: endDate },
        totalEntries: entries.length,
        version: "1.0"
      },
      entries: {}
    };

    // Add entries to export data
    entries.forEach(entry => {
      exportData.entries[entry.date] = entry.content;
    });

    // If including empty dates, add all dates in range
    if (includeEmpty === 'true') {
      const currentDate = new Date(startDate);
      const end = new Date(endDate);

      while (currentDate <= end) {
        const dateStr = formatDate(currentDate);
        if (!exportData.entries[dateStr]) {
          exportData.entries[dateStr] = '';
        }
        currentDate.setDate(currentDate.getDate() + 1);
      }
    }

    res.json(exportData);
  } catch (error) {
    console.error('Export error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Helper functions
function getWeekNumber(d) {
  d = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return weekNo;
}

function formatDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// Start server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
