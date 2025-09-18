const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const { MongoClient, ObjectId } = require('mongodb');
const path = require('path');
const cron = require('node-cron');
const axios = require('axios');
const cheerio = require('cheerio');

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
        secure: false,
        maxAge: 24 * 60 * 60 * 1000
    }
}));

// Variables globales
let client;
const mongoUri = process.env.MONGODB_URI;

// Conectar a MongoDB
async function connectDB() {
    try {
        client = new MongoClient(mongoUri);
        await client.connect();
        console.log('✅ Conectado a MongoDB Atlas');
        return client;
    } catch (error) {
        console.error('❌ Error conectando a MongoDB:', error);
        process.exit(1);
    }
}

// Middleware para anuncios y user
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
                res.locals.showAds = user.plan === 'free';
            } else {
                res.locals.user = null;
                res.locals.showAds = false;
            }
        } catch (error) {
            console.error('Error fetching user:', error);
            res.locals.user = null;
            res.locals.showAds = false;
        }
    } else {
        res.locals.user = null;
        res.locals.showAds = false;
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

app.get('/pricing.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'pricing.html'));
});

app.get('/help.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'help.html'));
});

app.get('/contact.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'contact.html'));
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

        const existingUser = await usersCollection.findOne({ email });
        if (existingUser) {
            return res.status(400).json({ error: 'El usuario ya existe' });
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        
        const result = await usersCollection.insertOne({
            email,
            password: hashedPassword,
            plan: plan || 'free',
            createdAt: new Date(),
            updatedAt: new Date()
        });

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

        const user = await usersCollection.findOne({ email });
        if (!user) {
            return res.status(400).json({ error: 'Usuario no encontrado' });
        }

        const validPassword = await bcrypt.compare(password, user.password);
        if (!validPassword) {
            return res.status(400).json({ error: 'Contraseña incorrecta' });
        }

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

// Ruta para el panel de cuenta
app.get('/account', async (req, res) => {
    if (!req.session.userId) {
        return res.redirect('/login.html');
    }
    
    try {
        const db = client.db();
        const user = await db.collection('users').findOne({ 
            _id: new ObjectId(req.session.userId) 
        });
        
        const userUrls = await db.collection('urls').find({ 
            userId: req.session.userId 
        }).toArray();
        
        res.render('account', { 
            user: {
                id: user._id,
                email: user.email,
                plan: user.plan
            },
            urls: userUrls
        });
    } catch (error) {
        console.error('Error loading account:', error);
        res.redirect('/');
    }
});

// API para añadir URLs
app.post('/api/urls', async (req, res) => {
    if (!req.session.userId) {
        return res.status(401).json({ error: 'No autorizado' });
    }
    
    try {
        const { url, notificationEmail, telegramId, notificationType } = req.body;
        const db = client.db();
        
        // Verificar límite según plan
        const urlCount = await db.collection('urls').countDocuments({ 
            userId: req.session.userId 
        });
        
        const user = await db.collection('users').findOne({ 
            _id: new ObjectId(req.session.userId) 
        });
        
        if (user.plan === 'free' && urlCount >= 5) {
            return res.status(400).json({ 
                error: 'Límite de 5 webs alcanzado. Mejora a Premium para webs ilimitadas.' 
            });
        }
        
        // Verificar si la URL ya existe para este usuario
        const existingUrl = await db.collection('urls').findOne({
            userId: req.session.userId,
            url: url
        });
        
        if (existingUrl) {
            return res.status(400).json({ 
                error: 'Esta URL ya está siendo monitorizada' 
            });
        }
        
        // Guardar URL
        const result = await db.collection('urls').insertOne({
            userId: req.session.userId,
            url: url,
            notificationEmail: notificationEmail,
            telegramId: telegramId,
            notificationType: notificationType || 'email',
            checkTime: '12:00',
            lastChecked: null,
            lastHash: '',
            lastStatus: 'pending',
            createdAt: new Date(),
            updatedAt: new Date(),
            isActive: true
        });
        
        res.json({ 
            success: true, 
            message: 'URL añadida correctamente',
            redirect: '/account'  // Redirigir a account en lugar de home
        });
        
    } catch (error) {
        console.error('Error adding URL:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// Nueva ruta para obtener URLs del usuario
app.get('/api/user/urls', async (req, res) => {
    if (!req.session.userId) {
        return res.status(401).json({ error: 'No autorizado' });
    }
    
    try {
        const db = client.db();
        const urls = await db.collection('urls')
            .find({ userId: req.session.userId })
            .sort({ createdAt: -1 })
            .toArray();
        
        res.json({ success: true, urls });
    } catch (error) {
        console.error('Error fetching URLs:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// Añadir esta ruta en server.js
app.get('/api/user/urls', async (req, res) => {
    if (!req.session.userId) {
        return res.status(401).json({ error: 'No autorizado' });
    }
    
    try {
        const db = client.db();
        const urls = await db.collection('urls')
            .find({ userId: req.session.userId })
            .sort({ createdAt: -1 })
            .toArray();
        
        res.json({ success: true, urls });
    } catch (error) {
        console.error('Error fetching URLs:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// API para eliminar URLs
app.delete('/api/urls/:id', async (req, res) => {
    if (!req.session.userId) {
        return res.status(401).json({ error: 'No autorizado' });
    }
    
    try {
        const db = client.db();
        await db.collection('urls').deleteOne({
            _id: new ObjectId(req.params.id),
            userId: req.session.userId
        });
        
        res.json({ success: true, message: 'URL eliminada correctamente' });
    } catch (error) {
        console.error('Error deleting URL:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// API para upgrade a Premium
app.post('/api/upgrade-to-premium', async (req, res) => {
    if (!req.session.userId) {
        return res.status(401).json({ error: 'No autorizado' });
    }

    try {
        const db = client.db();
        
        await db.collection('users').updateOne(
            { _id: new ObjectId(req.session.userId) },
            { 
                $set: { 
                    plan: 'premium',
                    premiumSince: new Date(),
                    updatedAt: new Date()
                } 
            }
        );

        req.session.userPlan = 'premium';
        
        res.json({ 
            success: true, 
            message: '¡Felicidades! Ahora eres usuario Premium',
            redirect: '/account'
        });

    } catch (error) {
        console.error('Error upgrading to premium:', error);
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

// Función para generar hash del contenido (usando crypto nativo de Node.js)
function generateHash(content) {
    const crypto = require('crypto');
    return crypto.createHash('md5').update(content).digest('hex');
}

// Función para verificar una URL
async function checkUrl(urlData) {
    try {
        console.log(`🔍 Verificando URL: ${urlData.url}`);
        
        const response = await axios.get(urlData.url, {
            timeout: 30000,
            headers: {
                'User-Agent': 'OpoAlert-Bot/1.0 (+https://opoalert.com)'
            }
        });
        
        const content = response.data;
        const currentHash = generateHash(content);
        
        const db = client.db();
        
        if (!urlData.lastHash) {
            await db.collection('urls').updateOne(
                { _id: urlData._id },
                { 
                    $set: { 
                        lastHash: currentHash,
                        lastChecked: new Date(),
                        lastStatus: 'success'
                    } 
                }
            );
            return { changed: false, firstCheck: true };
        }
        
        if (urlData.lastHash === currentHash) {
            await db.collection('urls').updateOne(
                { _id: urlData._id },
                { 
                    $set: { 
                        lastChecked: new Date(),
                        lastStatus: 'success'
                    } 
                }
            );
            return { changed: false };
        } else {
            await db.collection('urls').updateOne(
                { _id: urlData._id },
                { 
                    $set: { 
                        lastHash: currentHash,
                        lastChecked: new Date(),
                        lastStatus: 'changed',
                        lastChange: new Date()
                    } 
                }
            );
            
            await db.collection('changes').insertOne({
                urlId: urlData._id,
                userId: urlData.userId,
                url: urlData.url,
                oldHash: urlData.lastHash,
                newHash: currentHash,
                changedAt: new Date(),
                contentType: response.headers['content-type']
            });
            
            return { changed: true };
        }
        
    } catch (error) {
        console.error(`Error verificando ${urlData.url}:`, error.message);
        
        const db = client.db();
        await db.collection('urls').updateOne(
            { _id: urlData._id },
            { 
                $set: { 
                    lastChecked: new Date(),
                    lastStatus: 'error',
                    lastError: error.message
                } 
            }
        );
        
        return { changed: false, error: error.message };
    }
}

// Programar la verificación diaria a las 12:00
cron.schedule('0 12 * * *', async () => {
    console.log('⏰ Iniciando verificación diaria de URLs...');
    
    try {
        const db = client.db();
        const urls = await db.collection('urls')
            .find({ isActive: true })
            .toArray();
        
        console.log(`📊 Encontradas ${urls.length} URLs para verificar`);
        
        for (const urlData of urls) {
            try {
                const result = await checkUrl(urlData);
                
                await new Promise(resolve => setTimeout(resolve, 1000));
                
            } catch (error) {
                console.error(`Error procesando URL ${urlData.url}:`, error);
            }
        }
        
        console.log('✅ Verificación diaria completada');
        
    } catch (error) {
        console.error('Error en verificación diaria:', error);
    }
}, {
    timezone: "Europe/Madrid"
});

// Iniciar servidor
async function startServer() {
    try {
        await connectDB();
        app.listen(PORT, () => {
            console.log(`🚀 OpoAlert ejecutándose en puerto ${PORT}`);
            console.log('⏰ Verificación programada: 12:00 daily (Europe/Madrid)');
        });
    } catch (error) {
        console.error('Error iniciando servidor:', error);
        process.exit(1);
    }
}

startServer();
