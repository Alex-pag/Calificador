// Pruebas de la lógica de calificación. Ejecutar con:  node --test tests/
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../js/calificador.js');

const DATOS = [
  { nombre: 'Alumno', buscar: 'alumno|estudiante', tipo: 'texto', puntos: 4 },
  { nombre: 'Matrícula', buscar: '\\b\\d{6,10}\\b', tipo: 'patron', puntos: 4 },
  { nombre: 'Docente', buscar: 'docente|profesor', tipo: 'texto', puntos: 2 }
];

test('normalización: quita acentos y mayúsculas', () => {
  assert.equal(C.normalizar('José ÁNGEL Pérez'), 'jose angel perez');
  assert.equal(C.normalizar('Matrícula'), 'matricula');
  assert.equal(C.normalizar('PINGÜINO'), 'pinguino');
  assert.equal(C.normalizar(null), '');
});

test('normalización con mapa conserva las posiciones del texto original', () => {
  const { texto, mapa } = C.normalizarConMapa('Él año');
  assert.equal(texto, 'el ano');
  assert.equal(mapa.length, texto.length + 1);
  assert.equal(mapa[texto.length], 'Él año'.length);
});

test('búsqueda por texto: sin distinguir mayúsculas ni acentos', () => {
  const datos = [{ nombre: 'Docente', buscar: 'Profesor|DOCENTE', tipo: 'texto', puntos: 1 }];
  const r = C.calificar('Nombre del docénte: Ana López', datos);
  assert.equal(r.detalles[0].encontrado, true);
  assert.equal(r.detalles[0].fragmento.hallado, 'docénte');
});

test('búsqueda por texto: basta con que aparezca una de las palabras', () => {
  const datos = [{ nombre: 'Alumno', buscar: 'alumno | estudiante | ', tipo: 'texto', puntos: 1 }];
  assert.equal(C.calificar('ESTUDIANTE: Juan', datos).detalles[0].encontrado, true);
  assert.equal(C.calificar('Solo un texto', datos).detalles[0].encontrado, false);
});

test('búsqueda por texto: frases toleran saltos de línea y espacios dobles', () => {
  const datos = [{ nombre: 'Alumno', buscar: 'nombre del alumno', tipo: 'texto', puntos: 1 }];
  assert.equal(C.calificar('Nombre   del\nALUMNO: Luis', datos).detalles[0].encontrado, true);
});

test('búsqueda por texto: caracteres especiales se buscan literalmente', () => {
  const datos = [{ nombre: 'Precio', buscar: '$10.00 (aprox)', tipo: 'texto', puntos: 1 }];
  assert.equal(C.calificar('Cuesta $10.00 (aprox) en total', datos).detalles[0].encontrado, true);
  assert.equal(C.calificar('Cuesta $10X00 aprox', datos).detalles[0].encontrado, false);
});

test('búsqueda por patrón: matrícula de 6 a 10 dígitos', () => {
  const datos = [{ nombre: 'Matrícula', buscar: '\\b\\d{6,10}\\b', tipo: 'patron', puntos: 1 }];
  const r = C.calificar('Matrícula: 20231234', datos);
  assert.equal(r.detalles[0].encontrado, true);
  assert.equal(r.detalles[0].fragmento.hallado, '20231234');
  assert.equal(C.calificar('Matrícula: 12345', datos).detalles[0].encontrado, false);
  assert.equal(C.calificar('Número 12345678901', datos).detalles[0].encontrado, false);
});

test('búsqueda por patrón: ignora mayúsculas y acentos, y respeta \\D, \\S, \\W', () => {
  const acentos = [{ nombre: 'Mes', buscar: 'septi[eé]mbre', tipo: 'patron', puntos: 1 }];
  assert.equal(C.calificar('15 de SEPTIÉMBRE', acentos).detalles[0].encontrado, true);

  // Si el patrón se pasara a minúsculas, \S se convertiría en \s y fallaría.
  const correo = [{ nombre: 'Correo', buscar: '\\S+@\\S+\\.\\S+', tipo: 'patron', puntos: 1 }];
  const r = C.calificar('Correo: ana@escuela.mx', correo);
  assert.equal(r.detalles[0].encontrado, true);
  assert.equal(r.detalles[0].fragmento.hallado, 'ana@escuela.mx');
});

test('patrones de ejemplo: fecha en varios formatos', () => {
  const fecha = C.configEjemplo().datos.find((d) => d.nombre === 'Fecha');
  for (const t of ['Fecha: 05/03/2025', '2025-03-05', '5 de marzo de 2025', '12-11-24', '3 DE SEPTIEMBRE']) {
    assert.equal(C.calificar(t, [fecha]).detalles[0].encontrado, true, t);
  }
  assert.equal(C.calificar('Sin fecha aquí', [fecha]).detalles[0].encontrado, false);
});

test('cálculo proporcional: cada dato que falta resta sus puntos', () => {
  const completo = C.calificar('Alumno: Ana. Matrícula 123456. Profesor: Luis', DATOS);
  assert.equal(completo.nota, 20);
  assert.equal(completo.obtenidos, 10);
  assert.equal(completo.totales, 10);

  // Falta el docente (2 de 10 puntos): 20 × 8 / 10 = 16
  assert.equal(C.calificar('Alumno: Ana. Matrícula 123456.', DATOS).nota, 16);
  // Solo el docente: 20 × 2 / 10 = 4
  assert.equal(C.calificar('Profesor: Luis', DATOS).nota, 4);
  // Nada: 0
  assert.equal(C.calificar('', DATOS).nota, 0);
});

test('cálculo proporcional: decimales 0, 1 y 2', () => {
  const datos = [
    { nombre: 'A', buscar: 'aaa', tipo: 'texto', puntos: 1 },
    { nombre: 'B', buscar: 'bbb', tipo: 'texto', puntos: 1 },
    { nombre: 'C', buscar: 'ccc', tipo: 'texto', puntos: 1 }
  ];
  // 20 × 2 / 3 = 13.333…
  assert.equal(C.calificar('aaa bbb', datos, { decimales: 0 }).notaTexto, '13');
  assert.equal(C.calificar('aaa bbb', datos, { decimales: 1 }).notaTexto, '13.3');
  assert.equal(C.calificar('aaa bbb', datos, { decimales: 2 }).notaTexto, '13.33');
  // 20 × 1 / 3 = 6.666…
  assert.equal(C.calificar('aaa', datos, { decimales: 2 }).nota, 6.67);
  // Un valor de decimales no válido usa el predeterminado (1)
  assert.equal(C.calificar('aaa', datos, { decimales: 7 }).notaTexto, '6.7');
});

test('modo todo o nada: si falta cualquier dato la nota es 0', () => {
  const opciones = { modo: 'todo' };
  assert.equal(C.calificar('Alumno: Ana. Matrícula 123456. Profesor: Luis', DATOS, opciones).nota, 20);
  assert.equal(C.calificar('Alumno: Ana. Matrícula 123456.', DATOS, opciones).nota, 0);
  assert.equal(C.calificar('', DATOS, opciones).nota, 0);
});

test('regex inválido no rompe nada: se marca como no encontrado con error', () => {
  const datos = [
    { nombre: 'Roto', buscar: '([a-z', tipo: 'patron', puntos: 5 },
    { nombre: 'Alumno', buscar: 'alumno', tipo: 'texto', puntos: 5 }
  ];
  let r;
  assert.doesNotThrow(() => { r = C.calificar('Alumno: Ana ([a-z', datos); });
  assert.equal(r.detalles[0].encontrado, false);
  assert.match(r.detalles[0].error, /Patrón inválido/);
  assert.equal(r.detalles[1].encontrado, true);
  assert.equal(r.nota, 10);
  assert.notEqual(C.validarPatron('([a-z'), null);
  assert.equal(C.validarPatron('\\d+'), null);
});

test('casos límite: sin datos, puntos inválidos y texto vacío', () => {
  assert.equal(C.calificar('lo que sea', []).nota, 0);
  const datos = [
    { nombre: 'A', buscar: 'aaa', tipo: 'texto', puntos: -3 },
    { nombre: 'B', buscar: 'bbb', tipo: 'texto', puntos: 'abc' },
    { nombre: 'C', buscar: 'ccc', tipo: 'texto', puntos: '5' }
  ];
  const r = C.calificar('ccc', datos);
  assert.equal(r.totales, 5);
  assert.equal(r.nota, 20);
  const vacio = C.calificar('algo', [{ nombre: 'V', buscar: ' | ', tipo: 'texto', puntos: 1 }]);
  assert.equal(vacio.detalles[0].encontrado, false);
  assert.ok(vacio.detalles[0].error);
});

test('nivel de color de la nota', () => {
  assert.equal(C.nivelNota(20), 'verde');
  assert.equal(C.nivelNota(14), 'verde');
  assert.equal(C.nivelNota(13.9), 'amarillo');
  assert.equal(C.nivelNota(10), 'amarillo');
  assert.equal(C.nivelNota(9.99), 'rojo');
});

test('validarConfig limpia la configuración importada', () => {
  const c = C.validarConfig({ datos: [{ nombre: 'X', buscar: 'x', tipo: 'otro', puntos: '3' }], modo: 'todo', decimales: 2 });
  assert.deepEqual(c, { datos: [{ nombre: 'X', buscar: 'x', tipo: 'texto', puntos: 3 }], modo: 'todo', decimales: 2 });
  assert.equal(C.validarConfig([{ nombre: 'Y', buscar: 'y', tipo: 'patron', puntos: 1 }]).datos[0].tipo, 'patron');
  assert.throws(() => C.validarConfig({ algo: 1 }), /datos/);
  assert.throws(() => C.validarConfig('texto'));
});

test('configEjemplo: cinco datos de 4 puntos y copias independientes', () => {
  const a = C.configEjemplo();
  assert.equal(a.datos.length, 5);
  assert.ok(a.datos.every((d) => d.puntos === 4));
  a.datos[0].puntos = 99;
  assert.equal(C.configEjemplo().datos[0].puntos, 4);
  for (const d of a.datos.filter((d) => d.tipo === 'patron')) assert.equal(C.validarPatron(d.buscar), null);
});
