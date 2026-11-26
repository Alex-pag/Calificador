// Pruebas del análisis del documento modelo y de la comparación alumno ↔ profesor.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../js/calificador.js');
const R = require('../js/referencia.js');

const MODELO = [
  'Nombre del alumno: ________\tMatrícula: ______',
  'Grupo: ____\tFecha de entrega: ____',
  'Docente: Ana López',
  'LA FOTOSÍNTESIS',
  '1. Introducción',
  'La fotosíntesis es el proceso por el cual las plantas transforman la luz solar en energía química. Las plantas usan clorofila.',
  '2. Desarrollo',
  'Durante la fotosíntesis la clorofila absorbe la luz y produce glucosa y oxígeno. La glucosa alimenta a las plantas y el oxígeno se libera.',
  'Conclusiones',
  'Sin la fotosíntesis no habría oxígeno suficiente ni alimento para los seres vivos que dependen de las plantas y de la glucosa.'
].join('\n');

test('detecta campos con etiqueta y valor corto, también varios en una línea', () => {
  const campos = R.detectarCampos(MODELO).map((c) => c.etiqueta);
  assert.deepEqual(campos, ['Nombre del alumno', 'Matrícula', 'Grupo', 'Fecha de entrega', 'Docente']);
});

test('no confunde frases largas con campos ni toma enlaces', () => {
  const t = 'Instrucciones: lee el texto completo y responde las preguntas del final\nVer https://ejemplo.com';
  assert.deepEqual(R.detectarCampos(t), []);
});

test('detecta títulos por numeración, mayúsculas o párrafo largo después', () => {
  const titulos = R.detectarTitulos(MODELO);
  assert.deepEqual(titulos, ['LA FOTOSÍNTESIS', '1. Introducción', '2. Desarrollo', 'Conclusiones']);
  assert.equal(R.limpiarTitulo('1.2 Marco teórico:'), 'Marco teórico');
  assert.equal(R.limpiarTitulo('IV. Resultados'), 'Resultados');
  assert.equal(R.limpiarTitulo('Ideas principales'), 'Ideas principales');
});

test('palabras clave: las más repetidas, sin palabras vacías ni etiquetas', () => {
  const r = R.analizar(MODELO);
  assert.ok(r.claves.includes('plantas'));
  assert.ok(r.claves.includes('glucosa'));
  assert.ok(r.claves.includes('oxígeno'));
  assert.ok(!r.claves.includes('para'));
  assert.ok(!r.claves.includes('fotosíntesis'), 'ya está en un título');
  assert.ok(!r.claves.includes('alumno'), 'es una etiqueta de campo');
});

test('analizar genera criterios válidos y un resumen', () => {
  const r = R.analizar(MODELO, { nombre: 'modelo.docx' });
  assert.equal(r.resumen.nombre, 'modelo.docx');
  assert.equal(r.resumen.campos, 5);
  assert.deepEqual(r.secciones, ['LA FOTOSÍNTESIS', 'Introducción', 'Desarrollo', 'Conclusiones']);
  assert.ok(r.longitud.min < r.palabras && r.longitud.max > r.palabras);
  for (const d of r.datos) assert.equal(C.validarCriterio(d), null, d.nombre);
  assert.deepEqual([...new Set(r.datos.map((d) => d.tipo))], ['campo', 'seccion', 'claves', 'longitud']);
  // Ningún criterio generado usa expresiones regulares: el profesor no las ve.
  assert.ok(r.datos.every((d) => d.tipo !== 'patron'));
});

test('no toma como títulos filas de tabla, preguntas ni frases cortadas', () => {
  const t = [
    'DATOS PERSONALES',
    'Primer Apellido\tSegundo Apellido\tNombres\tEdad (años)',
    'Llene con letra clara cada uno de los datos que se solicitan en este formato de solicitud.',
    '¿Tiene Licencia de',
    'Conducir vigente y en buen estado, indique el tipo y el número de licencia que tiene.',
    'Experiencia en',
    'Describa los últimos tres empleos que ha tenido, con fechas, puestos y motivos de salida.',
    'DOCUMENTACIÓN'
  ].join('\n');
  assert.deepEqual(R.detectarTitulos(t), ['DATOS PERSONALES', 'DOCUMENTACIÓN']);
  // También se filtran los títulos marcados con estilo
  const r = R.analizar('x', { titulos: ['Datos generales:', '¿Tiene Licencia de', 'Nombre\tEdad', 'Referencias'] });
  assert.deepEqual(r.secciones, ['Datos generales', 'Referencias']);
});

test('usa los títulos que da el lector de archivos si los hay', () => {
  const r = R.analizar('Texto cualquiera', { titulos: ['Capítulo uno', '2. Marco teórico', 'capítulo UNO'] });
  assert.deepEqual(r.secciones, ['Capítulo uno', 'Marco teórico']);
});

test('el documento del profesor obtiene 20 contra sí mismo si se llenan los campos', () => {
  const r = R.analizar(MODELO);
  const lleno = MODELO.replace(/_+/g, 'X1');
  assert.equal(C.calificar(lleno, r.datos).nota, 20);
});

test('un campo vacío (solo guiones bajos) no cuenta', () => {
  const r = R.analizar(MODELO);
  const res = C.calificar(MODELO, r.datos);
  const nombre = res.detalles.find((d) => d.nombre === 'Nombre del alumno');
  const docente = res.detalles.find((d) => d.nombre === 'Docente');
  assert.equal(nombre.encontrado, false);
  assert.equal(docente.encontrado, true);
});

test('alumno parecido vs. alumno incompleto', () => {
  const r = R.analizar(MODELO);
  const bueno = [
    'Nombre del alumno: Luis Gómez   Matrícula: 20231234',
    'Grupo: 3B   Fecha de entrega: 5/03/2025   Docente: Ana López',
    'La fotosíntesis',
    'Introducción',
    'Las plantas transforman la luz del sol en energía química gracias a la clorofila; así fabrican su alimento.',
    'Desarrollo',
    'La clorofila absorbe la luz y con agua y dióxido de carbono la planta produce glucosa y libera oxígeno al aire.',
    'Conclusiones',
    'Gracias a la fotosíntesis existe el oxígeno que respiramos y la glucosa que alimenta a las plantas y a otros seres.'
  ].join('\n');
  const malo = 'Nombre del alumno: Luis\nHice la tarea de las plantas.';
  const nb = C.calificar(bueno, r.datos).nota;
  const nm = C.calificar(malo, r.datos).nota;
  assert.ok(nb >= 18, 'bueno: ' + nb);
  assert.ok(nm < 6, 'malo: ' + nm);
});

test('criterio de palabras clave da puntos parciales', () => {
  const datos = [{ nombre: 'Claves', buscar: 'sol|luna|estrella|cometa', tipo: 'claves', puntos: 8 }];
  const r = C.calificar('El SOL y la Luna', datos);
  assert.equal(r.detalles[0].fraccion, 0.5);
  assert.equal(r.detalles[0].encontrado, false);
  assert.equal(r.obtenidos, 4);
  assert.equal(r.nota, 10);
  assert.match(r.detalles[0].info, /2 de 4.*estrella, cometa/);
  // En todo o nada, una lista incompleta cuenta como faltante
  assert.equal(C.calificar('sol luna', datos, { modo: 'todo' }).nota, 0);
  assert.equal(C.calificar('sol luna estrella cometa', datos, { modo: 'todo' }).nota, 20);
});

test('palabras clave aceptan variantes de la misma raíz y muestran las faltantes con acentos', () => {
  const datos = [{ nombre: 'Claves', buscar: 'evaporación|océanos|precipitación|sol|ciclo del agua', tipo: 'claves', puntos: 5 }];
  const r = C.calificar('El agua del OCÉANO se evapora con el sol', datos);
  assert.match(r.detalles[0].info, /Aparecen 3 de 5\. Faltan: precipitación, ciclo del agua$/);
  // La raíz debe estar al inicio de una palabra
  assert.equal(C.calificar('reevaporar', [{ nombre: 'C', buscar: 'evaporación', tipo: 'claves', puntos: 1 }]).nota, 0);
  // Sin terminación que quitar: palabra completa o plural («sol», «soles»), pero no «solo»
  const sol = [{ nombre: 'C', buscar: 'sol', tipo: 'claves', puntos: 1 }];
  assert.equal(C.calificar('los soles', sol).nota, 20);
  assert.equal(C.calificar('SOL.', sol).nota, 20);
  assert.equal(C.calificar('solo', sol).nota, 0);
  assert.equal(C.calificar('las tierras', [{ nombre: 'C', buscar: 'tierra', tipo: 'claves', puntos: 1 }]).nota, 20);
});

test('tipo campo: la etiqueta debe estar llena, aunque el valor esté en la línea siguiente', () => {
  const datos = [{ nombre: 'Puesto que está solicitando', buscar: 'Puesto que está solicitando', tipo: 'campo', puntos: 1 }];
  assert.equal(C.calificar('PUESTO QUE ESTA SOLICITANDO: Cajero', datos).nota, 20);
  assert.equal(C.calificar('Puesto que está solicitando:\nCajero', datos).nota, 20);
  assert.equal(C.calificar('Puesto que está solicitando: ______', datos).nota, 0);
  assert.equal(C.calificar('Puesto que está solicitando:', datos).nota, 0);
  const r = C.calificar('Puesto que está solicitando: Cajero', datos);
  assert.equal(r.detalles[0].fragmento.hallado, 'Puesto que está solicitando:');
  assert.ok(C.validarCriterio({ tipo: 'campo', buscar: '  ' }));
});

test('tipo sección: el título debe aparecer', () => {
  const datos = [{ nombre: 'Sección: Datos personales', buscar: 'Datos personales', tipo: 'seccion', puntos: 1 }];
  assert.equal(C.calificar('1. DATOS PERSONALES', datos).nota, 20);
  assert.equal(C.calificar('Datos', datos).nota, 0);
});

test('tipo número: cantidad de cifras sin contar números más largos', () => {
  const mat = [{ nombre: 'Matrícula', buscar: '6-10', tipo: 'numero', puntos: 1 }];
  assert.equal(C.calificar('Matrícula: 20231234', mat).nota, 20);
  assert.equal(C.calificar('A20231234B', mat).nota, 20);
  assert.equal(C.calificar('Tel 12345', mat).nota, 0);
  assert.equal(C.calificar('Folio 123456789012', mat).nota, 0);
  assert.equal(C.calificar('CP 97000', [{ nombre: 'CP', buscar: '5', tipo: 'numero', puntos: 1 }]).nota, 20);
  assert.ok(C.validarCriterio({ tipo: 'numero', buscar: '0-3' }));
  assert.ok(C.validarCriterio({ tipo: 'numero', buscar: 'muchas' }));
});

test('tipo fecha: cualquier formato habitual', () => {
  const f = [{ nombre: 'Fecha', buscar: '', tipo: 'fecha', puntos: 1 }];
  for (const t of ['05/03/2025', '5-3-25', '2025-03-05', '5 de MARZO']) assert.equal(C.calificar(t, f).nota, 20, t);
  assert.equal(C.calificar('marzo', f).nota, 0);
});

test('configuraciones guardadas con expresiones regulares se convierten a tipos sencillos', () => {
  const viejo = C.validarConfig({ datos: [
    { nombre: 'Matrícula', buscar: '\\b\\d{6,10}\\b', tipo: 'patron', puntos: 4 },
    { nombre: 'Puesto que está solicitando', buscar: 'puesto\\s+que\\s+esta\\s+solicitando\\s*[:\\-–.]?(?=\\s*[^\\s_:.\\-–])', tipo: 'patron', puntos: 2 },
    { nombre: 'Docente', buscar: 'docente\\s*[:\\-–.]?\\s*[^\\s_:.\\-–]', tipo: 'patron', puntos: 2 },
    { nombre: 'Código', buscar: '[A-Z]{3}-\\d+', tipo: 'patron', puntos: 1 }
  ] });
  assert.deepEqual(viejo.datos.map((d) => d.tipo + ':' + d.buscar), [
    'numero:6-10', 'campo:Puesto que está solicitando', 'campo:Docente', 'patron:[A-Z]{3}-\\d+'
  ]);
});

test('criterio de longitud cuenta palabras dentro del rango', () => {
  const datos = [{ nombre: 'Extensión', buscar: '3-5', tipo: 'longitud', puntos: 1 }];
  assert.equal(C.calificar('uno dos', datos).nota, 0);
  assert.equal(C.calificar('uno dos tres', datos).nota, 20);
  assert.equal(C.calificar('uno, dos-tres cuatro cinco.', datos).nota, 20);
  assert.equal(C.calificar('1 2 3 4 5 6', datos).nota, 0);
  assert.match(C.calificar('a b c d', datos).detalles[0].info, /4 palabras/);
  assert.deepEqual(C.rangoLongitud('500 a 300'), { min: 300, max: 500 });
  assert.equal(C.rangoLongitud('mucho'), null);
  const mal = C.calificar('a b c', [{ nombre: 'X', buscar: 'muchas', tipo: 'longitud', puntos: 1 }]);
  assert.equal(mal.nota, 0);
  assert.ok(mal.detalles[0].error);
});

test('código para compartir: ida y vuelta con acentos, y desde un enlace', () => {
  const r = R.analizar(MODELO, { nombre: 'Tarea de ñandú.docx' });
  const config = { datos: r.datos, modo: 'todo', decimales: 2, referencia: r.resumen };
  const codigo = C.codificarConfig(config);
  assert.match(codigo, /^[A-Za-z0-9_-]+$/);
  assert.deepEqual(C.decodificarConfig(codigo), C.validarConfig(config));
  assert.deepEqual(C.decodificarConfig('https://x.github.io/app/#alumno=' + codigo), C.validarConfig(config));
  assert.throws(() => C.decodificarConfig('esto no es un código!'), /no es válido/);
  assert.throws(() => C.decodificarConfig('abc'), /dañado/);
});
