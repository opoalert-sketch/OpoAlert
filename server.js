const express = require('express');
const path = require('path');
const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(__dirname));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.post('/api/urls', (req, res) => {
  res.json({ message: 'URL añadida correctamente a OpoAlert', data: req.body });
});

app.listen(port, () => {
  console.log(`OpoAlert ejecutándose en el puerto ${port}`);
});