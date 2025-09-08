const express = require('express');
const bcrypt = require('bcryptjs');
const { MongoClient } = require('mongodb');
const session = require('express-session');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(__dirname));
app.use(session({
    secret: 'opoalert-secret-key',
    resave: false,
    saveUninitialized: false
}));

// Conexión MongoDB
const mongoUri = process.env.MONGODB_URI;
const client = new MongoClient(mongoUri);

// Ruta de registro
app.post('/api/register', async (req, res) => {
    try {
        const { email, password, plan } = req.body;
        
        // Conectar a la base de datos
        await client.connect();
        const db = client.db();
        const usersCollection = db.collection('users');
        
        // Verificar si el usuario ya existe
        const existingUser = await usersCollection.findOne({ email });
        if (existingUser) {
            return res.status(400).send('El usuario ya existe');
        }
        
        // Hashear la contraseña
        const hashedPassword = await bcrypt.hash(password, 10);
        
        // Guardar usuario
        await usersCollection.insertOne({
            email,
            password: hashedPassword,
            plan: plan || 'free',
            createdAt: new Date()
        });
        
        res.redirect('/login.html?success=1');
    } catch (error) {
        console.error('Error en registro:', error);
        res.status(500).send('Error interno del servidor');
    }
});

// Ruta de login
app.post('/api/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        
        await client.connect();
        const db = client.db();
        const usersCollection = db.collection('users');
        
        // Buscar usuario
        const user = await usersCollection.findOne({ email });
        if (!user) {
            return res.redirect('/login.html?error=1');
        }
        
        // Verificar contraseña
        const validPassword = await bcrypt.compare(password, user.password);
        if (!validPassword) {
            return res.redirect('/login.html?error=1');
        }
        
        // Crear sesión
        req.session.userId = user._id;
        req.session.userEmail = user.email;
        req.session.userPlan = user.plan;
        
        res.redirect('/');
    } catch (error) {
        console.error('Error en login:', error);
        res.status(500).send('Error interno del servidor');
    }
});

app.listen(PORT, () => {
    console.log(`OpoAlert ejecutándose en puerto ${PORT}`);
});