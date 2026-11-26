/*
 * calificador.js — Lógica de calificación (sin dependencias).
 * Funciona en el navegador (window.Calificador) y en Node (module.exports).
 *
 * Tipos de criterio (en «buscar» va lo que indica cada uno):
 *   campo     etiqueta de un campo que debe estar lleno («Nombre del alumno» → «Nombre del alumno: Ana»).
 *   seccion   título que debe aparecer.
 *   texto     palabras separadas por "|"; basta con que aparezca una.
 *   claves    palabras separadas por "|"; da puntos en proporción a las que aparezcan.
 *   longitud  rango de palabras "min-max" (ej. "300-500").
 *   numero    número con una cantidad de cifras "min-max" (ej. "6-10" para una matrícula).
 *   fecha     cualquier fecha (dd/mm/aaaa, aaaa-mm-dd o «5 de marzo»); «buscar» no se usa.
 *   patron    expresión regular (avanzado).
 */
(function (raiz, fabrica) {
  'use strict';
  if (typeof module === 'object' && module.exports) {
    module.exports = fabrica();
  } else {
    raiz.Calificador = fabrica();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var NOTA_MAXIMA = 20;
  var DIACRITICOS = /[̀-ͯ]/g;
  var CONTEXTO = 40; // caracteres alrededor del fragmento encontrado
  var TIPOS = ['campo', 'seccion', 'texto', 'claves', 'longitud', 'numero', 'fecha', 'patron'];

  var PATRON_FECHA = '\\b\\d{1,2}[/.-]\\d{1,2}[/.-]\\d{2,4}\\b|\\b\\d{4}-\\d{2}-\\d{2}\\b|\\b\\d{1,2}\\s+de\\s+(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre)\\b';
  var PATRON_MATRICULA_ANTIGUO = '\\b\\d{6,10}\\b';

  var DATOS_EJEMPLO = [
    { nombre: 'Nombre del alumno', buscar: 'nombre del alumno|alumno|alumna|estudiante', tipo: 'texto', puntos: 4 },
    { nombre: 'Matrícula', buscar: '6-10', tipo: 'numero', puntos: 4 },
    { nombre: 'Fecha', buscar: '', tipo: 'fecha', puntos: 4 },
    { nombre: 'Grupo / grado', buscar: 'grupo|grado|semestre', tipo: 'texto', puntos: 4 },
    { nombre: 'Nombre del docente', buscar: 'docente|profesor|profesora|maestro|maestra', tipo: 'texto', puntos: 4 }
  ];

  var CONFIG_PREDETERMINADA = { modo: 'proporcional', decimales: 1 };

  /** Quita acentos y pasa a minúsculas. "José ÁNGEL" -> "jose angel". */
  function normalizar(texto) {
    return String(texto == null ? '' : texto)
      .normalize('NFD')
      .replace(DIACRITICOS, '')
      .toLowerCase();
  }

  /**
   * Normaliza el texto y guarda, para cada carácter normalizado, su posición
   * en el texto original. Así se puede mostrar el fragmento original (con acentos).
   */
  function normalizarConMapa(texto) {
    texto = String(texto == null ? '' : texto);
    var partes = [];
    var mapa = [];
    for (var i = 0; i < texto.length; ) {
      var cp = texto.codePointAt(i);
      var ch = String.fromCodePoint(cp);
      var n = normalizar(ch);
      for (var k = 0; k < n.length; k++) mapa.push(i);
      partes.push(n);
      i += ch.length;
    }
    mapa.push(texto.length);
    return { texto: partes.join(''), mapa: mapa };
  }

  /** Cuenta las palabras de un texto (letras o números, con guiones o apóstrofos internos). */
  function contarPalabras(texto) {
    var m = String(texto == null ? '' : texto).match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu);
    return m ? m.length : 0;
  }

  /** Extrae un fragmento legible del texto original alrededor de [inicio, fin). */
  function fragmento(original, inicio, fin) {
    var a = Math.max(0, inicio - CONTEXTO);
    var b = Math.min(original.length, fin + CONTEXTO);
    var limpiar = function (s) { return s.replace(/\s+/g, ' '); };
    return {
      antes: (a > 0 ? '…' : '') + limpiar(original.slice(a, inicio)).replace(/^ /, ''),
      hallado: limpiar(original.slice(inicio, fin)),
      despues: limpiar(original.slice(fin, b)).replace(/ $/, '') + (b < original.length ? '…' : '')
    };
  }

  /** Separa "a | b |c" en ["a","b","c"] ya normalizados, sin vacíos. */
  function terminos(buscar) {
    return String(buscar == null ? '' : buscar)
      .split('|')
      .map(function (t) { return normalizar(t).replace(/\s+/g, ' ').trim(); })
      .filter(function (t) { return t.length > 0; });
  }

  function escaparRegex(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /** Busca un término normalizado; los espacios del término aceptan cualquier espacio o salto de línea. */
  function buscarTermino(textoNormal, termino) {
    var re = new RegExp(termino.split(' ').map(escaparRegex).join('\\s+'));
    return re.exec(textoNormal);
  }

  // Terminaciones que se quitan para comparar por raíz (de la más larga a la más corta).
  var SUFIJOS = ['amientos', 'imientos', 'aciones', 'iciones', 'amiento', 'imiento', 'idades', 'ciones',
    'acion', 'icion', 'mente', 'cion', 'idad', 'es', 'os', 'as', 's'];

  /** Raíz aproximada de una palabra normalizada: «evaporacion» → «evapor», «oceanos» → «ocean». */
  function raiz(palabra) {
    for (var i = 0; i < SUFIJOS.length; i++) {
      var s = SUFIJOS[i];
      if (palabra.length - s.length >= 4 && palabra.slice(-s.length) === s) return palabra.slice(0, -s.length);
    }
    return palabra;
  }

  /**
   * Busca una palabra clave admitiendo variantes: una palabra sola se busca por su raíz
   * al inicio de una palabra («evaporación» acepta «evapora», «evaporar»). Si no tiene
   * terminación que quitar, se busca la palabra completa o su plural («sol», «soles»,
   * pero no «solo»). Una frase se busca tal cual.
   */
  function buscarClave(textoNormal, termino) {
    if (termino.indexOf(' ') !== -1 || !/^[a-z0-9]+$/.test(termino)) return buscarTermino(textoNormal, termino);
    var r = raiz(termino);
    var fin = r === termino ? '(?:es|s)?(?![a-z0-9])' : '';
    return new RegExp('(?:^|[^a-z0-9])' + r + fin).exec(textoNormal);
  }

  /**
   * Crea la expresión regular para un patrón. Solo se quitan los acentos del
   * patrón: no se pasa a minúsculas porque cambiaría \D, \W, \S, \B, etc.
   * La bandera "i" se encarga de ignorar mayúsculas.
   */
  function crearRegex(patron) {
    var limpio = String(patron == null ? '' : patron).normalize('NFD').replace(DIACRITICOS, '');
    if (!limpio.trim()) throw new Error('El patrón está vacío');
    return new RegExp(limpio, 'i');
  }

  /** Lee un rango "300-500" (también "300 a 500" o un solo número "8"). Devuelve {min, max} o null. */
  function rangoLongitud(texto) {
    var s = String(texto == null ? '' : texto);
    var uno = /^\s*(\d+)\s*$/.exec(s);
    if (uno) return { min: Number(uno[1]), max: Number(uno[1]) };
    var m = /^\s*(\d+)\s*(?:-|–|a)\s*(\d+)\s*$/i.exec(s);
    if (!m) return null;
    var a = Number(m[1]);
    var b = Number(m[2]);
    return a <= b ? { min: a, max: b } : { min: b, max: a };
  }

  /**
   * Patrón de un campo que debe estar lleno: «Nombre: Ana» sí, «Nombre: ____» no.
   * La revisión del valor va en una búsqueda anticipada (?=…) para resaltar solo la etiqueta.
   */
  function patronCampo(etiqueta) {
    var partes = normalizar(etiqueta).replace(/[:\s]+$/, '').trim().split(/\s+/).map(escaparRegex);
    return partes.join('\\s+') + '\\s*[:\\-–.]?(?=\\s*[^\\s_:.\\-–])';
  }

  /** Expresión regular que usa cada tipo (null para los que buscan texto). */
  function regexDeCriterio(dato) {
    switch (dato.tipo) {
      case 'campo': return new RegExp(patronCampo(dato.buscar));
      case 'fecha': return new RegExp(PATRON_FECHA, 'i');
      case 'numero':
        var r = rangoLongitud(dato.buscar);
        return new RegExp('(?<![0-9])[0-9]{' + r.min + ',' + r.max + '}(?![0-9])');
      case 'patron': return crearRegex(dato.buscar);
      default: return null;
    }
  }

  /** Valida un patrón. Devuelve null si es válido o el mensaje de error. */
  function validarPatron(patron) {
    try {
      crearRegex(patron);
      return null;
    } catch (e) {
      return e.message;
    }
  }

  /** Revisa que un criterio se pueda evaluar. Devuelve null o el mensaje de error. */
  function validarCriterio(dato) {
    var tipo = TIPOS.indexOf(dato && dato.tipo) === -1 ? 'texto' : dato.tipo;
    switch (tipo) {
      case 'patron':
        var e = validarPatron(dato.buscar);
        return e ? 'Patrón inválido: ' + e : null;
      case 'longitud':
        return rangoLongitud(dato.buscar) ? null : 'Escribe cuántas palabras, por ejemplo de 300 a 500.';
      case 'numero':
        var r = rangoLongitud(dato.buscar);
        return r && r.min > 0 && r.max <= 50 ? null : 'Escribe cuántas cifras debe tener (de 1 a 50).';
      case 'fecha':
        return null;
      case 'campo':
        return normalizar(dato.buscar).replace(/[:\s]+$/, '').trim() ? null : 'Escribe el nombre del campo.';
      case 'seccion':
        return terminos(dato.buscar).length ? null : 'Escribe el título.';
      default:
        return terminos(dato && dato.buscar).length ? null : 'Escribe al menos una palabra.';
    }
  }

  /**
   * Evalúa un criterio en un texto ya preparado con normalizarConMapa.
   * Devuelve { fraccion (0 a 1), fragmento, info, error }.
   */
  function evaluarCriterio(preparado, original, palabras, dato) {
    var tipo = TIPOS.indexOf(dato.tipo) === -1 ? 'texto' : dato.tipo;
    var error = validarCriterio(dato);
    if (error) return { fraccion: 0, fragmento: null, info: null, error: error };
    var texto = preparado.texto;

    if (tipo === 'longitud') {
      var r = rangoLongitud(dato.buscar);
      var ok = palabras >= r.min && palabras <= r.max;
      return {
        fraccion: ok ? 1 : 0,
        fragmento: null,
        info: palabras + ' palabras (se esperan de ' + r.min + ' a ' + r.max + ')',
        error: null
      };
    }

    if (tipo === 'claves') {
      var lista = terminos(dato.buscar);
      // Para mostrar las palabras que faltan como las escribió el profesor (con acentos).
      var originales = String(dato.buscar).split('|').map(function (t) { return t.replace(/\s+/g, ' ').trim(); })
        .filter(function (t) { return normalizar(t).trim().length > 0; });
      var faltan = originales.filter(function (t, i) { return !buscarClave(texto, lista[i]); });
      var halladas = lista.length - faltan.length;
      return {
        fraccion: halladas / lista.length,
        fragmento: null,
        info: 'Aparecen ' + halladas + ' de ' + lista.length + (faltan.length ? '. Faltan: ' + faltan.join(', ') : ''),
        error: null
      };
    }

    var inicio = -1;
    var fin = -1;
    if (tipo === 'texto' || tipo === 'seccion') {
      terminos(dato.buscar).forEach(function (t) {
        var m = buscarTermino(texto, t);
        if (m && (inicio === -1 || m.index < inicio)) {
          inicio = m.index;
          fin = m.index + m[0].length;
        }
      });
    } else {
      var p = regexDeCriterio({ tipo: tipo, buscar: dato.buscar }).exec(texto);
      if (p) {
        inicio = p.index;
        fin = p.index + p[0].length;
      }
    }
    if (inicio === -1) return { fraccion: 0, fragmento: null, info: null, error: null };
    return {
      fraccion: 1,
      fragmento: fragmento(original, preparado.mapa[inicio], preparado.mapa[fin]),
      info: null,
      error: null
    };
  }

  function puntosValidos(p) {
    var n = Number(p);
    return isFinite(n) && n > 0 ? n : 0;
  }

  function decimalesValidos(d) {
    var n = parseInt(d, 10);
    if (n === 0 || n === 1 || n === 2) return n;
    return CONFIG_PREDETERMINADA.decimales;
  }

  function redondear(valor, decimales) {
    var f = Math.pow(10, decimales);
    return Math.round((valor + Number.EPSILON) * f) / f;
  }

  /**
   * Califica un texto.
   * @param {string} texto
   * @param {Array<{nombre,buscar,tipo,puntos}>} datos
   * @param {{modo?: 'proporcional'|'todo', decimales?: 0|1|2}} opciones
   */
  function calificar(texto, datos, opciones) {
    opciones = opciones || {};
    var modo = opciones.modo === 'todo' ? 'todo' : 'proporcional';
    var decimales = decimalesValidos(opciones.decimales);
    var original = String(texto == null ? '' : texto);
    var preparado = normalizarConMapa(original);
    var palabras = contarPalabras(original);
    datos = Array.isArray(datos) ? datos : [];

    var totales = 0;
    var obtenidos = 0;
    var incompletos = 0;
    var detalles = datos.map(function (dato) {
      dato = dato || {};
      var puntos = puntosValidos(dato.puntos);
      var r = evaluarCriterio(preparado, original, palabras, dato);
      var obtenido = puntos * r.fraccion;
      totales += puntos;
      obtenidos += obtenido;
      if (r.fraccion < 1) incompletos++;
      return {
        nombre: String(dato.nombre || 'Sin nombre'),
        tipo: TIPOS.indexOf(dato.tipo) === -1 ? 'texto' : dato.tipo,
        puntos: puntos,
        obtenido: obtenido,
        fraccion: r.fraccion,
        encontrado: r.fraccion === 1,
        fragmento: r.fragmento,
        info: r.info,
        error: r.error
      };
    });

    var nota;
    if (totales <= 0) {
      nota = 0;
    } else if (modo === 'todo') {
      nota = incompletos === 0 ? NOTA_MAXIMA : 0;
    } else {
      nota = (NOTA_MAXIMA * obtenidos) / totales;
    }
    nota = redondear(nota, decimales);

    return {
      nota: nota,
      notaTexto: nota.toFixed(decimales),
      decimales: decimales,
      modo: modo,
      palabras: palabras,
      obtenidos: redondear(obtenidos, 2),
      totales: totales,
      detalles: detalles
    };
  }

  /** Color de la nota: verde ≥14, amarillo ≥10, rojo <10. */
  function nivelNota(nota) {
    if (nota >= 14) return 'verde';
    if (nota >= 10) return 'amarillo';
    return 'rojo';
  }

  function enteroValido(n) {
    n = Number(n);
    return isFinite(n) && n > 0 ? Math.round(n) : 0;
  }

  /**
   * Convierte expresiones regulares de versiones anteriores en los tipos sencillos
   * equivalentes, para que el profesor no las vea: campos, matrícula y fecha.
   */
  function migrarCriterio(d) {
    if (d.tipo !== 'patron') return d;
    if (d.buscar === PATRON_MATRICULA_ANTIGUO) return { nombre: d.nombre, buscar: '6-10', tipo: 'numero', puntos: d.puntos };
    if (d.buscar === PATRON_FECHA) return { nombre: d.nombre, buscar: '', tipo: 'fecha', puntos: d.puntos };
    var etiqueta = normalizar(d.nombre).split(/\s+/).map(escaparRegex).join('\\s+');
    var anterior = etiqueta + '\\s*[:\\-–.]?\\s*[^\\s_:.\\-–]';
    if (d.nombre && (d.buscar === patronCampo(d.nombre) || d.buscar === anterior)) {
      return { nombre: d.nombre, buscar: d.nombre, tipo: 'campo', puntos: d.puntos };
    }
    return d;
  }

  /**
   * Limpia y valida una configuración (por ejemplo, la importada como JSON).
   * Acepta { datos, modo, decimales, referencia? } o directamente un arreglo de datos.
   * Lanza un Error con un mensaje en español si no es válida.
   */
  function validarConfig(obj) {
    if (Array.isArray(obj)) obj = { datos: obj };
    if (!obj || typeof obj !== 'object') throw new Error('La configuración debe ser un objeto JSON.');
    if (!Array.isArray(obj.datos)) throw new Error('Falta la lista "datos".');
    var datos = obj.datos.map(function (d, i) {
      if (!d || typeof d !== 'object') throw new Error('El dato ' + (i + 1) + ' no es válido.');
      return migrarCriterio({
        nombre: String(d.nombre == null ? '' : d.nombre),
        buscar: String(d.buscar == null ? '' : d.buscar),
        tipo: TIPOS.indexOf(d.tipo) === -1 ? 'texto' : d.tipo,
        puntos: puntosValidos(d.puntos)
      });
    });
    var config = {
      datos: datos,
      modo: obj.modo === 'todo' ? 'todo' : 'proporcional',
      decimales: decimalesValidos(obj.decimales)
    };
    var ref = obj.referencia;
    if (ref && typeof ref === 'object') {
      config.referencia = {
        nombre: String(ref.nombre == null ? '' : ref.nombre).slice(0, 200),
        palabras: enteroValido(ref.palabras),
        parrafos: enteroValido(ref.parrafos),
        secciones: enteroValido(ref.secciones),
        campos: enteroValido(ref.campos),
        claves: enteroValido(ref.claves)
      };
    }
    return config;
  }

  function configEjemplo() {
    return {
      datos: DATOS_EJEMPLO.map(function (d) { return Object.assign({}, d); }),
      modo: CONFIG_PREDETERMINADA.modo,
      decimales: CONFIG_PREDETERMINADA.decimales
    };
  }

  /* ---------- Código para compartir con los alumnos ---------- */

  /** Convierte la configuración en un código de texto seguro para un enlace. */
  function codificarConfig(config) {
    var bytes = new TextEncoder().encode(JSON.stringify(validarConfig(config)));
    var binario = '';
    for (var i = 0; i < bytes.length; i++) binario += String.fromCharCode(bytes[i]);
    return btoa(binario).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  /** Lee un código (o un enlace que contenga "alumno=<código>"). Lanza Error si no es válido. */
  function decodificarConfig(texto) {
    var codigo = String(texto == null ? '' : texto).trim();
    var enlace = /[#?&]alumno=([A-Za-z0-9_-]+)/.exec(codigo);
    if (enlace) codigo = enlace[1];
    codigo = codigo.replace(/\s+/g, '');
    if (!/^[A-Za-z0-9_-]+$/.test(codigo)) throw new Error('El código no es válido.');
    var json;
    try {
      var binario = atob(codigo.replace(/-/g, '+').replace(/_/g, '/'));
      var bytes = new Uint8Array(binario.length);
      for (var i = 0; i < binario.length; i++) bytes[i] = binario.charCodeAt(i);
      json = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    } catch (e) {
      throw new Error('El código está incompleto o dañado.');
    }
    return validarConfig(json);
  }

  return {
    NOTA_MAXIMA: NOTA_MAXIMA,
    TIPOS: TIPOS,
    normalizar: normalizar,
    normalizarConMapa: normalizarConMapa,
    contarPalabras: contarPalabras,
    terminos: terminos,
    escaparRegex: escaparRegex,
    rangoLongitud: rangoLongitud,
    patronCampo: patronCampo,
    validarPatron: validarPatron,
    validarCriterio: validarCriterio,
    calificar: calificar,
    nivelNota: nivelNota,
    validarConfig: validarConfig,
    configEjemplo: configEjemplo,
    codificarConfig: codificarConfig,
    decodificarConfig: decodificarConfig
  };
});
