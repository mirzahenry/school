const Pool = require('pg').Pool;
require('dotenv').config();

// Use explicit fields so the pg driver never tries to parse
// special characters (like @) out of a connection string URL
function buildPoolConfig() {
    if (process.env.SUPABASE_HOST) {
        // Explicit Supabase fields take priority
        return {
            host:     process.env.SUPABASE_HOST,
            port:     parseInt(process.env.SUPABASE_PORT) || 6543,
            database: process.env.SUPABASE_DB   || 'postgres',
            user:     process.env.SUPABASE_USER,
            password: process.env.SUPABASE_PASS,
            ssl:      { rejectUnauthorized: false },
            max:      10,
            idleTimeoutMillis:       30000,
            connectionTimeoutMillis: 10000,
        };
    }
    if (process.env.DATABASE_URL) {
        return { connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } };
    }
    return {
        user:     process.env.DB_USER     || 'postgres',
        password: process.env.DB_PASSWORD || 'your_password',
        host:     process.env.DB_HOST     || 'localhost',
        port:     parseInt(process.env.DB_PORT) || 5432,
        database: process.env.DB_NAME     || 'smart_school_db',
    };
}

const pool = new Pool(buildPoolConfig());

// Log connection errors so they are visible in the server console
pool.on('error', (err) => {
    console.error('Unexpected database pool error:', err.message);
});

// Test the connection on startup
pool.query('SELECT 1')
    .then(() => console.log('✅ Database connected successfully'))
    .catch((err) => console.error('❌ Database connection failed:', err.message));

module.exports = pool;