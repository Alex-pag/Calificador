/*
 * referencia.js — Analiza el documento modelo del profesor y obtiene sus
 * métricas clave: campos a llenar, secciones (títulos), palabras clave y extensión.
 * Con ellas genera los criterios con los que se califica al alumno.
 * Funciona en el navegador (window.Referencia) y en Node (module.exports).
 */
(function (raiz, fabrica) {
  'use strict';
  if (typeof module === 'object' && module.exports) {
    module.exports = fabrica(require('./calificador.js'));
  } else {
    raiz.Referencia = fabrica(raiz.Calificador);
  }
})(typeof self !== 'undefined' ? self : this, function (C) {
  'use strict';

  var MAX_CAMPOS = 12;
  var MAX_SECCIONES = 15;
  var MAX_CLAVES = 10;
  var TOLERANCIA_LONGITUD = 0.3; // ±30 %
  var MIN_PALABRAS_LONGITUD = 30;

  /** Puntos predeterminados de cada criterio generado (el profesor puede cambiarlos). */
  var PUNTOS = { campo: 2, seccion: 2, claves: 6, longitud: 2 };

  // Palabras muy comunes del español (sin acentos) que no sirven como palabras clave.
  var VACIAS = new Set((
    'a al algo algun alguna algunas alguno algunos ante antes aqui asi aun aunque bajo bien cada casi como con contra cual cuales ' +
    'cuando cuanto de del desde donde dos e el ella ellas ello ellos en entre era eran eres es esa esas ese eso esos esta estaba ' +
    'estado estan estar estas este esto estos fue fueron ha haber habia han hasta hay hacer hace hacen hecho la las le les lo los ' +
    'mas me mi mis mismo mucho muy nada ni no nos nosotros o otra otras otro otros para pero poco por porque puede pueden pues que ' +
    'quien se segun ser si sido sin sobre solo son su sus tal tambien tan tanto te tiene tienen todo todos toda todas tras tu tus ' +
    'un una uno unos unas usted ya yo cual cuya cuyo dentro durante mediante tener tiempo vez veces asimismo ademas entonces ' +
    'luego despues donde mientras siempre nunca cosa cosas forma parte manera ejemplo etc the and for with that this from'
  ).split(/\s+/));

  var LETRA = 'A-Za-zÁÉÍÓÚÜÑáéíóúüñ';
  var NUMERACION = /^(?:\d+(?:\.\d+)*[.)-]?|[IVXLC]+[.)-])\s+/;

  function lineasDe(texto) {
    return String(texto == null ? '' : texto)
      .split(/\r?\n/)
      .map(function (l) { return l.trim(); })
      .filter(function (l) { return l.length > 0; });
  }

  function mayusculaInicial(s) {
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  function sinRelleno(s) {
    return s.replace(/[_.…\-–—\s]+/g, ' ').trim();
  }

  /**
   * Campos del tipo «Etiqueta: valor» o «Etiqueta: ______». Solo se toman si la
   * etiqueta tiene de 1 a 4 palabras y el valor es corto (máx. 6 palabras), para no
   * confundir frases como «Instrucciones: lee el texto y responde…».
   */
  function detectarCampos(texto) {
    var re = new RegExp('(^|\\t|_|\\s{2,})([' + LETRA + '][' + LETRA + 'º°.]*(?: [' + LETRA + 'º°./]+){0,3})\\s*:(?!//)', 'g');
    var campos = [];
    var vistos = new Set();
    lineasDe(texto).forEach(function (linea) {
      var hallados = [];
      var m;
      re.lastIndex = 0;
      while ((m = re.exec(linea))) {
        hallados.push({ etiqueta: m[2].trim(), inicioValor: m.index + m[0].length, inicio: m.index + m[1].length });
      }
      hallados.forEach(function (h, i) {
        var finValor = i + 1 < hallados.length ? hallados[i + 1].inicio : linea.length;
        var valor = sinRelleno(linea.slice(h.inicioValor, finValor));
        var clave = C.normalizar(h.etiqueta);
        if (C.contarPalabras(valor) > 6) return;
        if (/^(https?|www|nota)$/.test(clave) || vistos.has(clave)) return;
        vistos.add(clave);
        campos.push({ etiqueta: mayusculaInicial(h.etiqueta.replace(/\s+/g, ' ')), lleno: valor.length > 0 });
      });
    });
    return campos.slice(0, MAX_CAMPOS);
  }

  function esMayusculas(s) {
    var letras = s.replace(new RegExp('[^' + LETRA + ']', 'g'), '');
    return letras.length >= 4 && letras === letras.toUpperCase();
  }

  // Un título no termina en estas palabras; si lo hace, es una frase cortada («¿Tiene licencia de»).
  var FINAL_CORTADO = /\s(de|del|la|las|el|los|y|o|u|e|en|a|al|con|para|por|que|su|sus|un|una)$/i;

  /** ¿Puede esta línea ser un título? Descarta filas de tabla, preguntas y frases cortadas. */
  function puedeSerTitulo(l) {
    var palabras = C.contarPalabras(l);
    if (palabras < 1 || palabras > 10 || l.length < 3) return false;
    if (/[:.,;]$/.test(l) || l.indexOf(':') !== -1 || /_{2,}/.test(l)) return false;
    if (l.indexOf('\t') !== -1) return false;          // fila de tabla o encabezados de columna
    if (/^[¿¡]|\?$/.test(l)) return false;             // preguntas
    if (FINAL_CORTADO.test(l)) return false;
    return new RegExp('[' + LETRA + ']{3,}').test(l);
  }

  /**
   * Títulos por heurística (para PDF, .txt, etc.): líneas cortas, sin «:» ni punto final,
   * que estén numeradas, en MAYÚSCULAS o seguidas de un párrafo largo.
   */
  function detectarTitulos(texto) {
    var lineas = lineasDe(texto);
    var titulos = [];
    lineas.forEach(function (l, i) {
      if (!puedeSerTitulo(l)) return;
      var siguiente = lineas[i + 1] || '';
      var empiezaMayuscula = new RegExp('^(?:\\d[\\d.)-]*\\s+)?[A-ZÁÉÍÓÚÜÑ¿¡]').test(l);
      if (NUMERACION.test(l) || esMayusculas(l) || (empiezaMayuscula && C.contarPalabras(siguiente) >= 12)) {
        titulos.push(l);
      }
    });
    return titulos;
  }

  /** Quita la numeración («1.2 », «II. ») y los caracteres que estorban en la búsqueda. */
  function limpiarTitulo(t) {
    return String(t).replace(NUMERACION, '').replace(/\|/g, ' ').replace(/[:\s]+$/, '').replace(/\s+/g, ' ').trim();
  }

  function unicos(lista) {
    var vistos = new Set();
    return lista.filter(function (t) {
      var k = C.normalizar(t);
      if (!k || vistos.has(k)) return false;
      vistos.add(k);
      return true;
    });
  }

  /** Palabras que más se repiten (≥ 2 veces, ≥ 4 letras), sin palabras vacías ni las ya usadas. */
  function detectarClaves(texto, excluir) {
    var conteo = new Map();
    var orden = 0;
    (String(texto).match(/\p{L}+/gu) || []).forEach(function (palabra) {
      var k = C.normalizar(palabra);
      if (k.length < 4 || VACIAS.has(k) || excluir.has(k)) return;
      var e = conteo.get(k);
      if (e) e.n++;
      else conteo.set(k, { forma: palabra.toLowerCase(), n: 1, orden: orden++ });
    });
    return Array.from(conteo.values())
      .filter(function (e) { return e.n >= 2; })
      .sort(function (a, b) { return b.n - a.n || a.orden - b.orden; })
      .slice(0, MAX_CLAVES)
      .map(function (e) { return e.forma; });
  }

  function palabrasDe(lista) {
    var s = new Set();
    lista.forEach(function (t) {
      (C.normalizar(t).match(/[a-z0-9]+/g) || []).forEach(function (p) { s.add(p); });
    });
    return s;
  }

  /**
   * Analiza el texto del documento modelo.
   * @param {string} texto
   * @param {{titulos?: string[], nombre?: string}} opciones  titulos: los que el lector detectó por estilo.
   */
  function analizar(texto, opciones) {
    opciones = opciones || {};
    texto = String(texto == null ? '' : texto);
    var palabras = C.contarPalabras(texto);
    var parrafos = lineasDe(texto).length;
    var campos = detectarCampos(texto);

    // Los títulos marcados con estilo se aceptan aunque terminen en «:», pero no si son
    // preguntas, filas de tabla, frases cortadas o párrafos largos.
    var deEstilo = (Array.isArray(opciones.titulos) ? opciones.titulos : []).filter(function (t) {
      return puedeSerTitulo(String(t).replace(/[:\s]+$/, ''));
    });
    var titulosBase = deEstilo.length ? deEstilo : detectarTitulos(texto);
    var etiquetas = new Set(campos.map(function (c) { return C.normalizar(c.etiqueta); }));
    var secciones = unicos(titulosBase.map(limpiarTitulo))
      .filter(function (t) { return t.length >= 3 && !etiquetas.has(C.normalizar(t)); })
      .slice(0, MAX_SECCIONES);

    var excluir = palabrasDe(campos.map(function (c) { return c.etiqueta; }).concat(secciones));
    var claves = detectarClaves(texto, excluir);

    var datos = [];
    campos.forEach(function (c) {
      datos.push({ nombre: c.etiqueta, buscar: c.etiqueta, tipo: 'campo', puntos: PUNTOS.campo });
    });
    secciones.forEach(function (s) {
      datos.push({ nombre: 'Sección: ' + s, buscar: s, tipo: 'seccion', puntos: PUNTOS.seccion });
    });
    if (claves.length) {
      datos.push({ nombre: 'Palabras clave del tema', buscar: claves.join('|'), tipo: 'claves', puntos: PUNTOS.claves });
    }
    var longitud = null;
    if (palabras >= MIN_PALABRAS_LONGITUD) {
      longitud = {
        min: Math.round(palabras * (1 - TOLERANCIA_LONGITUD)),
        max: Math.round(palabras * (1 + TOLERANCIA_LONGITUD))
      };
      datos.push({ nombre: 'Extensión parecida al modelo', buscar: longitud.min + '-' + longitud.max, tipo: 'longitud', puntos: PUNTOS.longitud });
    }

    return {
      palabras: palabras,
      parrafos: parrafos,
      campos: campos,
      secciones: secciones,
      claves: claves,
      longitud: longitud,
      datos: datos,
      resumen: {
        nombre: String(opciones.nombre || ''),
        palabras: palabras,
        parrafos: parrafos,
        secciones: secciones.length,
        campos: campos.length,
        claves: claves.length
      }
    };
  }

  return {
    PUNTOS: PUNTOS,
    analizar: analizar,
    detectarCampos: detectarCampos,
    detectarTitulos: detectarTitulos,
    detectarClaves: detectarClaves,
    limpiarTitulo: limpiarTitulo
  };
});
