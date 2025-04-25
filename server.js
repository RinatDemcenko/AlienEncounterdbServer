import express from "express";
import mysql from "mysql2/promise";
import cors from "cors";
import fs from "fs";
import dotenv from "dotenv";
import bcrypt from "bcrypt";

dotenv.config();

const app = express();
app.use(express.json());
app.use(cors());
app.get("/", (req, res) => {
  res.send("Server spusteny!");
});

async function initializePool() {
  const pool = await mysql.createPool({
    host: process.env.DB_HOST,
    port: parseInt(process.env.DB_PORT),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_DATABASE,
    ssl: {
      ca: process.env.DB_SSL_CA || fs.readFileSync("./ca.pem"),
    },
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
  });
  return pool;
}

let pool;
(async () => {
  try {
    pool = await initializePool();
    const [rows] = await pool.query("SELECT 1");
    console.log("Uspesne pripojenie do DB");
  } catch (error) {
    console.error("Chyba pri pripojeni do DB:", error.stack);
    process.exit(1);
  }
})();

app.get("/api/mostObserved", async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 7;
    const order = req.query.order || "ASC";
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
        ) AS most_observed ORDER BY name ${order};
      `,
      [limit]
    );
    res.json(rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({
      dbError: "Nie je možné načítať údaje z databázy",
      details: error.message,
    });
  }
});

app.get("/api/mostVisited", async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 25;
    const order = req.query.order || "DESC";
    const [rows] = await pool.query(
      `
        SELECT 
          location_name,
          COUNT(*) as total_observations
        FROM observations
        GROUP BY location_name
        ORDER BY total_observations ${order}
        LIMIT ?;
      `,
      [limit]
    );
    res.json(rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({
      dbError: "Nie je možné načítať údaje z databázy",
      details: error.message,
    });
  }
});

app.get("/api/alienInteractions", async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 25;
    const order = req.query.order || "ASC";
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
        ORDER BY interactions_count ${order}
        LIMIT ?;
      `,
      [limit]
    );
    res.json(rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({
      dbError: "Nie je možné načítať údaje z databázy",
      details: error.message,
    });
  }
});

app.get("/api/recentAbductions", async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    const order = req.query.order || "DESC";
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
        ORDER BY abduction_date ${order}
        LIMIT ?;
      `,
      [limit]
    );
    res.json(rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({
      dbError: "Nie je možné načítať údaje z databázy",
      details: error.message,
    });
  }
});

app.post("/api/register", async (req, res) => {
  try {
    const { username, email, password } = req.body;
    const password_hash = await bcrypt.hash(password, 10);

    if (!username || !email || !password) {
      return res.status(400).json({ signUpError: "Prosím, vyplňte všetky polia" });
    }

    const [result] = await pool.query(
      `
      INSERT INTO users (username, email, password_hash)
      VALUES (?, ?, ?);
    `,
      [username, email, password_hash]
    );
    res.status(200).json({ id: result.insertId, username, email });
  } catch (error) {
    if (error.code == "ER_DUP_ENTRY") {
      res
        .status(409)
        .json({ signUpError: "Užívateľské meno alebo email už existuje" });
    } else {
      res.status(500).json({
        dbError: "Nie je možné zaregistrovať sa(Chyba databázy)",
        details: error.message,
      });
    }
  }
});

app.post("/api/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    const [users] = await pool.query(
      `
      SELECT * FROM users WHERE email = ?;
      `,
      [email]
    );
    if (users.length === 0) {
      res.status(401).json({ loginError: "Nesprávny email" });
      return;
    }
    const user = users[0];
    const isPasswordValid = await bcrypt.compare(password, user.password_hash);
    if (!isPasswordValid) {
      res.status(401).json({ loginError: "Nesprávne heslo" });
      return;
    }
    res
      .status(200)
      .json({ id: user.id, username: user.username, email: user.email });
  } catch (error) {
    res.status(500).json({
      dbError: "Nie je možné prihlásiť sa",
      details: error.message,
    });
  }
});

app.post("/api/reportUfoSighting", async (req, res) => {
  try {
    const { location, shipType, encounterDate, speciesId, userId } = req.body;

    if (!location || !shipType || !encounterDate || !speciesId || !userId) {
      return res.status(400).json({ error: "Všetky polia sú povinné" });
    }

    const [userCheck] = await pool.query(
      "SELECT id FROM users WHERE id = ?",
      [userId]
    );
    if (userCheck.length === 0) {
      return res.status(401).json({ error: "Neplatný používateľ" });
    }

    const [existingReport] = await pool.query(
      "SELECT id FROM observations WHERE user_id = ?",
      [userId]
    );

    if (existingReport.length > 0) {
      await pool.query(
        `
        UPDATE observations
        SET observation_date = ?, location_name = ?, spacecraft_type = ?
        WHERE user_id = ?
        `,
        [encounterDate, location, shipType, userId]
      );
      return res.status(200).json({ message: "Hlásenie bolo aktualizované"});
    } else {
      await pool.query(
        `
        INSERT INTO observations (observation_date, location_name, species_id, spacecraft_type, user_id)
        VALUES (?, ?, ?, ?, ?)
        `,
        [encounterDate, location, speciesId, shipType, userId]
      );
      return res.status(201).json({ message: "Hlásenie bolo vytvorené" });
    }
  } catch (error) {
    res.status(500).json({
      dbError: "Nie je možné spracovať hlásenie, chyba databazy",
      details: error.message,
    });
  }
});

const PORT = 3000;
const server = app.listen(PORT, () => {
  console.log(`Server bol úspešne spustený na port ${PORT}`);
});

const shutdown = async () => {
  server.close();
  await pool.end();
  process.exit(0);
};

process.on("SIGTERM", () => shutdown());
process.on("SIGINT", () => shutdown());
