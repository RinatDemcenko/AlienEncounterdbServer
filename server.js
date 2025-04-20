import express from 'express';
import mysql from 'mysql2/promise';
import cors from 'cors';
import fs from 'fs';
import dotenv from 'dotenv';

dotenv.config();

const app = express();

// process.env.X - premenne z vercel 
async function initializePool() {
  const pool = await mysql.createPool({
    host: process.env.DB_HOST,
    port: parseInt(process.env.DB_PORT),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_DATABASE,
    ssl: {
      ca: process.env.DB_SSL_CA || fs.readFileSync('./ca.pem')
    },
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
  });
  return pool; 
}

let pool;
(async () => {
  try {
    pool = await initializePool();
    const [rows] = await pool.query('SELECT 1');
    console.log('Uspesne pripojenie do DB');
  } catch (error) {
    console.error('Chyba pri pripojeni do DB:', error.stack);
    process.exit(1); 
  }
})();

// Middleware
app.use(express.json());
app.use(cors());

// Маршруты
app.get("/", (req, res) => {
  res.send("Server spusteny!");
});

app.get("/api/mostObserved", async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 7;
    const [rows] = await pool.query(
      `
        SELECT * FROM (
          SELECT
            species.name,
            species.home_planet,
            species.limbs_number,
            COUNT(*) AS observations_count
          FROM observations
          JOIN species ON observations.species_id = species.id
          GROUP BY species.name, species.home_planet, species.limbs_number 
          ORDER BY observations_count DESC
          LIMIT ?
        ) AS most_observed ORDER BY name ASC;
      `,
      [limit]
    );
    res.json(rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ dbError: 'Nie je možné načítať údaje z databázy', details: error.message });
  }
});

app.get("/api/mostVisited", async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 25;
    const [rows] = await pool.query(
      `
        SELECT 
          location_name,
          COUNT(*) as total_observations
        FROM observations
        GROUP BY location_name
        ORDER BY total_observations DESC
        LIMIT ?;
      `,
      [limit]
    );
    res.json(rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ dbError: 'Nie je možné načítať údaje z databázy', details: error.message });
  }
});

app.get("/api/alienInteractions", async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 25;
    const [rows] = await pool.query(
      `
        SELECT
          species.name,
          species.home_planet,
          species.limbs_number,
          COUNT(*) AS interactions_count,
          SUM(is_friendly) AS positive_interactions
        FROM interactions
        JOIN species ON interactions.species_id = species.id
        GROUP BY species.name, species.home_planet, species.limbs_number 
        ORDER BY interactions_count ASC
        LIMIT ?;
      `,
      [limit]
    );
    res.json(rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ dbError: 'Nie je možné načítať údaje z databázy', details: error.message });
  }
});

app.get("/api/recentAbductions", async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    const [rows] = await pool.query(
      `
        SELECT 
          interaction_id,
          human_name,
          abduction_date,  
          person_returned,
          species.name AS abductor_name,
          species.home_planet
        FROM abductions 
        JOIN interactions ON abductions.interaction_id = interactions.id
        JOIN species ON interactions.species_id = species.id
        ORDER BY abduction_date DESC
        LIMIT ?;
      `,
      [limit]
    );
    res.json(rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ dbError: 'Nie je možné načítať údaje z databázy', details: error.message });
  }
});

const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () => {
  console.log(`Server bol úspešne spustený na port ${PORT}`);
});

const shutdown = async () => {
  console.log('Shutting down server...');
  server.close();
  await pool.end();
  process.exit(0);
};

process.on('SIGTERM', () => shutdown());
process.on('SIGINT', () => shutdown());