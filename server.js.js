const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const { MongoClient, ObjectId } = require('mongodb');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Configuración
app.set('view engine', 'ejs');
app.set('views', __dirname);

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(__dirname));
app.use(session({
    secret: process.env.SESSION_SECRET || 'opoalert-secret-key-2024',
    resave: false,
    saveUninitialized: false,
    cookie: { 
        secure: false, // Cambiar a true en producción con HTTPS
        maxAge: 24 * 60 * 60 * 1000 // 24 horas
    }
}));

// Variables globales para la base de datos
let client;
const mongoUri = process.env.MONGODB_URI;

// Conectar a MongoDB
async function connectDB() {
    try {
        client = new MongoClient(mongoUri);
        await client.connect();
        console.log('Conectado a MongoDB Atlas');
        return client;
    } catch (error) {
        console.error('Error conectando a MongoDB:', error);
        process.exit(1);
    }
}

// Middleware para inyectar user en las vistas
app.use(async (req, res, next) => {
    if (req.session.userId) {
        try {
            const db = client.db();
            const user = await db.collection('users').findOne({ 
                _id: new ObjectId(req.session.userId) 
            });
            
            if (user) {
                res.locals.user = {
                    id: user._id,
                    email: user.email,
                    plan: user.plan
                };
            } else {
                res.locals.user = null;
            }
        } catch (error) {
            console.error('Error fetching user:', error);
            res.locals.user = null;
        }
    } else {
        res.locals.user = null;
    }
    next();
});

// Rutas principales
app.get('/', async (req, res) => {
    if (!res.locals.user) {
        return res.redirect('/login.html');
    }
    res.render('index', { user: res.locals.user });
});

// Servir archivos estáticos
app.get('/register.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'register.html'));
});

app.get('/login.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'login.html'));
});

// API - Registro de usuario
app.post('/api/register', async (req, res) => {
    try {
        const { email, password, plan } = req.body;
        
        if (!email || !password) {
            return res.status(400).json({ error: 'Email y contraseña son requeridos' });
        }

        const db = client.db();
        const usersCollection = db.collection('users');

        // Verificar si el usuario ya existe
        const existingUser = await usersCollection.findOne({ email });
        if (existingUser) {
            return res.status(400).json({ error: 'El usuario ya existe' });
        }

        // Encriptar contraseña
        const hashedPassword = await bcrypt.hash(password, 10);
        
        // Crear usuario
        const result = await usersCollection.insertOne({
            email,
            password: hashedPassword,
            plan: plan || 'free',
            createdAt: new Date(),
            updatedAt: new Date()
        });

        // Iniciar sesión automáticamente
        req.session.userId = result.insertedId.toString();
        
        res.json({ 
            success: true, 
            message: 'Usuario registrado correctamente',
            redirect: '/'
        });

    } catch (error) {
        console.error('Error en registro:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// API - Login de usuario
app.post('/api/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        
        if (!email || !password) {
            return res.status(400).json({ error: 'Email y contraseña son requeridos' });
        }

        const db = client.db();
        const usersCollection = db.collection('users');

        // Buscar usuario
        const user = await usersCollection.findOne({ email });
        if (!user) {
            return res.status(400).json({ error: 'Usuario no encontrado' });
        }

        // Verificar contraseña
        const validPassword = await bcrypt.compare(password, user.password);
        if (!validPassword) {
            return res.status(400).json({ error: 'Contraseña incorrecta' });
        }

        // Crear sesión
        req.session.userId = user._id.toString();
        
        res.json({ 
            success: true, 
            message: 'Login exitoso',
            redirect: '/'
        });

    } catch (error) {
        console.error('Error en login:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// Logout
app.get('/logout', (req, res) => {
    req.session.destroy((err) => {
        if (err) {
            console.error('Error cerrando sesión:', err);
        }
        res.redirect('/login.html');
    });
});

// Iniciar servidor
async function startServer() {
    try {
        await connectDB();
        app.listen(PORT, () => {
            console.log(`OpoAlert ejecutándose en http://localhost:${PORT}`);
        });
    } catch (error) {
        console.error('Error iniciando servidor:', error);
        process.exit(1);
    }
}

startServer();