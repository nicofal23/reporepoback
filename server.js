const express = require('express');
const cors = require('cors');
const mysql = require('mysql2');
require('dotenv').config();
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const fileUpload = require('express-fileupload');


const app = express();
const port = process.env.PORT || 3000;

app.use(fileUpload());

// Ruta para recibir y ensamblar los chunks
app.post('/api/upload-chunk', (req, res) => {
  const { chunkIndex, totalChunks, fileName } = req.body;
  const chunk = req.files.chunk;

  const uploadPath = path.join(__dirname, 'uploads', fileName);

  // Guardar el chunk en una parte del archivo
  chunk.mv(`${uploadPath}.part${chunkIndex}`, (err) => {
    if (err) {
      console.error('Error al mover el chunk:', err);
      return res.status(500).send(err);
    }

    // Si es el último chunk, ensamblar el archivo completo
    if (parseInt(chunkIndex, 10) === parseInt(totalChunks, 10) - 1) {
      const writeStream = fs.createWriteStream(uploadPath);

      for (let i = 0; i < totalChunks; i++) {
        const chunkPath = `${uploadPath}.part${i}`;
        const data = fs.readFileSync(chunkPath);
        writeStream.write(data);
        fs.unlinkSync(chunkPath); // Eliminar el chunk después de escribirlo
      }

      writeStream.end(() => {
        console.log('Archivo ensamblado completamente:', fileName);
        res.send({ message: 'Archivo subido y ensamblado con éxito' });
      });
    } else {
      res.send({ message: `Chunk ${chunkIndex + 1} de ${totalChunks} recibido` });
    }
  });
});

app.use(cors({
  origin: '*',
  methods: 'GET,POST,PUT,DELETE',
  credentials: true
}));
app.use(express.json({ limit: '100mb' }));// Asegúrate de que tu servidor puede manejar JSON en el cuerpo de las solicitudes
app.use(express.urlencoded({ limit: '100mb', extended: true }));


const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

// Ruta para obtener el tipo de cambio oficial
// Ruta para obtener el tipo de cambio oficial desde DolarAPI
app.get('/api/tipocambio', async (req, res) => {
    try {
      const response = await axios.get('https://dolarapi.com/v1/dolares/oficial');
      
      if (!response.data || !response.data.venta) {
        throw new Error('No se pudo obtener el valor del dólar oficial');
      }
  
      const tipoCambio = parseFloat(response.data.venta);
  
      res.json({ tipoCambio });
    } catch (error) {
      console.error('Error al obtener el tipo de cambio:', error.message);
      res.status(500).json({ error: 'Error al obtener el tipo de cambio' });
    }
  });


// Ruta para obtener los artículos con paginación, filtrado y ordenamiento
app.get('/api/articulos', (req, res) => {
  const { pagina = 1, limite = 15, buscar = '', categoria = '', orden = '' } = req.query;
  let query = `SELECT * FROM articulos WHERE 1=1`;

  if (buscar.length >= 3) {
    query += ` AND (NOMBRE LIKE '%${buscar}%' OR SKU LIKE '%${buscar}%')`;
  }

  if (categoria) {
    query += ` AND CATEGORIA = '${categoria}'`;
  }

  if (orden === 'asc') {
    query += ` ORDER BY PRECIO ASC`;
  } else if (orden === 'desc') {
    query += ` ORDER BY PRECIO DESC`;
  }

  const offset = (pagina - 1) * limite;
  query += ` LIMIT ${limite} OFFSET ${offset}`;

  pool.query(query, (err, results) => {
    if (err) {
      console.error('Error al obtener los artículos:', err);
      return res.status(500).send('Error al obtener los artículos');
    }
    res.json(results);
  });
});

// Ruta para obtener las categorías
app.get('/api/categorias', (req, res) => {
  pool.query('SELECT DISTINCT CATEGORIA FROM articulos', (err, results) => {
    if (err) {
      console.error('Error al obtener las categorías:', err);
      res.status(500).send('Error al obtener las categorías');
      return;
    }
    res.json(results.map(row => row.CATEGORIA));
  });
});

// Nueva ruta para aumentar precios globalmente
app.put('/api/articulos/aumentar-precios', (req, res) => {
  const { aumento } = req.body;

  if (!aumento || isNaN(aumento)) {
    return res.status(400).send('El aumento debe ser un número válido');
  }

  const porcentajeAumento = 1 + parseFloat(aumento) / 100;

  pool.query(
    'UPDATE articulos SET PRECIO = PRECIO * ?',
    [porcentajeAumento],
    (err, results) => {
      if (err) {
        console.error('Error al actualizar los precios:', err);
        return res.status(500).send('Error al actualizar los precios');
      }
      console.log(`${results.affectedRows} artículos actualizados.`);
      res.send('Precios aumentados con éxito');
    }
  );
});

// Ruta para actualizar un producto específico por SKU
app.put('/api/articulos/:sku', (req, res) => {
  const sku = req.params.sku;
  const { NOMBRE, PRECIO, CATEGORIA, LINK_IMG } = req.body;

  const query = `
    UPDATE articulos 
    SET NOMBRE = ?, PRECIO = ?, CATEGORIA = ?, LINK_IMG = ? 
    WHERE SKU = ?
  `;

  pool.query(query, [NOMBRE, PRECIO, CATEGORIA, LINK_IMG, sku], (err, results) => {
    if (err) {
      console.error('Error al actualizar el producto:', err);
      return res.status(500).send('Error al actualizar el producto');
    }

    res.send('Producto actualizado con éxito');
  });
});

// Iniciar el servidor
app.listen(port, () => {
  console.log(`Servidor corriendo en http://localhost:${port}`);
});
