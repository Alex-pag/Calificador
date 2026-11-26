/*
 * app.js — Interfaz con dos vistas:
 *   Profesor: documento modelo → métricas clave → criterios; compartir; calificar varios trabajos.
 *   Alumno:   sube su documento y lo compara con los criterios del profesor.
 * Depende de Calificador (calificador.js), Referencia (referencia.js) y Extractor (extractor.js).
 */
(function () {
  'use strict';

  var C = window.Calificador;
  var R = window.Referencia;
  var E = window.Extractor;
  var CLAVE = 'calificador-automatico:config:v1';
  var CLAVE_VISTA = 'calificador-automatico:vista';

  var $ = function (id) { return document.getElementById(id); };

  /* ---------- Utilidades ---------- */

  function leerAlmacen(clave) {
    try { return localStorage.getItem(clave); } catch (e) { return null; }
  }

  function escribirAlmacen(clave, valor) {
    try { localStorage.setItem(clave, valor); } catch (e) { /* modo privado o bloqueado: se ignora */ }
  }

  function crear(etiqueta, props, hijos) {
    var n = document.createElement(etiqueta);
    if (props) {
      Object.keys(props).forEach(function (k) {
        if (k === 'texto') n.textContent = props[k];
        else if (k === 'clase') n.className = props[k];
        else n.setAttribute(k, props[k]);
      });
    }
    (hijos || []).forEach(function (h) { if (h != null && h !== false) n.append(h); });
    return n;
  }

  function formatoNumero(n, decimales) {
    return Number(n).toLocaleString(undefined, { minimumFractionDigits: decimales, maximumFractionDigits: decimales });
  }

  function formatoPuntos(n) {
    return formatoNumero(n, Math.round(n * 100) % 100 ? 2 : 0).replace(/([.,]\d)0$/, '$1');
  }

  var temporizador;
  function avisar(msg) {
    var el = $('aviso');
    el.textContent = msg;
    el.classList.add('visible');
    clearTimeout(temporizador);
    temporizador = setTimeout(function () { el.classList.remove('visible'); }, 3200);
  }

  function copiarTexto(texto) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(texto).catch(function () { return copiarAntiguo(texto); });
    }
    return copiarAntiguo(texto);
  }

  function copiarAntiguo(texto) {
    return new Promise(function (resolver, rechazar) {
      var t = document.createElement('textarea');
      t.value = texto;
      t.setAttribute('readonly', '');
      t.style.position = 'fixed';
      t.style.opacity = '0';
      document.body.append(t);
      t.select();
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      t.remove();
      if (ok) resolver(); else rechazar(new Error('No se pudo copiar'));
    });
  }

  /** Conecta una zona de arrastre y su <input type="file">. */
  function conectarZona(zona, entrada, alRecibir) {
    entrada.setAttribute('accept', E.EXTENSIONES.concat(['doc', 'xls', 'ppt']).map(function (x) { return '.' + x; }).join(','));
    entrada.addEventListener('change', function () {
      alRecibir(Array.prototype.slice.call(entrada.files || []));
      entrada.value = '';
    });
    ['dragenter', 'dragover'].forEach(function (tipo) {
      zona.addEventListener(tipo, function (e) { e.preventDefault(); zona.classList.add('arrastrando'); });
    });
    ['dragleave', 'drop'].forEach(function (tipo) {
      zona.addEventListener(tipo, function (e) {
        e.preventDefault();
        if (tipo === 'dragleave' && zona.contains(e.relatedTarget)) return;
        zona.classList.remove('arrastrando');
      });
    });
    zona.addEventListener('drop', function (e) {
      if (e.dataTransfer) alRecibir(Array.prototype.slice.call(e.dataTransfer.files || []));
    });
  }
  // Evita que el navegador abra el archivo si se suelta fuera de una zona.
  window.addEventListener('dragover', function (e) { e.preventDefault(); });
  window.addEventListener('drop', function (e) { e.preventDefault(); });

  /* ---------- Configuración del profesor ---------- */

  function cargarConfig() {
    try {
      var guardada = leerAlmacen(CLAVE);
      if (guardada) return C.validarConfig(JSON.parse(guardada));
    } catch (e) { /* datos dañados */ }
    return C.configEjemplo();
  }

  var config = cargarConfig();
  var analisisModelo = null; // detalle del último documento modelo analizado (solo en memoria)

  function guardarConfig() {
    escribirAlmacen(CLAVE, JSON.stringify(config));
  }

  function cambioConfig() {
    guardarConfig();
    actualizarTotal();
    panelProfesor.recalificar();
    if (fuenteAlumno.tipo === 'local') pintarRequisitos();
    panelAlumno.recalificar();
  }

  /* ---------- Configuración del alumno (enlace > código > este navegador) ---------- */

  var fuenteAlumno = { tipo: 'local', config: null };
  var enlace = /[#&]alumno=([A-Za-z0-9_-]+)/.exec(location.hash);
  var modoEnlace = false;
  if (enlace) {
    try {
      fuenteAlumno = { tipo: 'enlace', config: C.decodificarConfig(enlace[1]) };
      modoEnlace = true;
    } catch (e) {
      setTimeout(function () { avisar('El enlace del profesor está incompleto o dañado. Pídele que lo copie de nuevo.'); }, 300);
    }
  }

  function configAlumno() {
    return fuenteAlumno.config || config;
  }

  /* ---------- Paneles de resultados (profesor y alumno) ---------- */

  function crearPanel(o) {
    var panel = { archivos: [] };
    var siguienteId = 1;

    panel.agregar = function (lista) {
      if (!lista.length) return;
      if (o.unico) panel.archivos = [];
      (o.unico ? lista.slice(0, 1) : lista).forEach(function (archivo) {
        var item = { id: siguienteId++, nombre: archivo.name, estado: 'leyendo', texto: '', aviso: null, error: null, resultado: null };
        panel.archivos.push(item);
        E.extraer(archivo)
          .then(function (r) {
            item.texto = r.texto;
            item.aviso = r.aviso;
            item.estado = 'listo';
            var cfg = o.config();
            item.resultado = C.calificar(item.texto, cfg.datos, cfg);
          })
          .catch(function (e) {
            item.estado = 'error';
            item.error = (e && e.message) || 'No se pudo leer el archivo.';
          })
          .then(panel.pintar);
      });
      panel.pintar();
    };

    panel.recalificar = function () {
      var cfg = o.config();
      panel.archivos.forEach(function (a) {
        if (a.estado === 'listo') a.resultado = C.calificar(a.texto, cfg.datos, cfg);
      });
      panel.pintar();
    };

    panel.limpiar = function () {
      panel.archivos = [];
      panel.pintar();
    };

    panel.pintar = function () {
      o.cuerpo.textContent = '';
      panel.archivos.forEach(function (a) { o.cuerpo.append(filaResultado(a)); });
      o.vacio.hidden = panel.archivos.length > 0;

      var listos = panel.archivos.filter(function (a) { return a.estado === 'listo'; });
      var errores = panel.archivos.filter(function (a) { return a.estado === 'error'; }).length;
      var partes = [];
      if (panel.archivos.length > 1) {
        partes.push(panel.archivos.length + ' archivos');
        if (listos.length) {
          var prom = listos.reduce(function (s, a) { return s + a.resultado.nota; }, 0) / listos.length;
          partes.push('promedio ' + formatoNumero(prom, o.config().decimales));
        }
      }
      var leyendo = panel.archivos.length - listos.length - errores;
      if (leyendo) partes.push(leyendo + ' leyendo…');
      o.resumen.textContent = partes.join(' · ');
    };

    /** Texto separado por tabuladores para pegar en Excel. */
    panel.texto = function () {
      var cfg = o.config();
      var filas = [['Archivo', 'Nota'].concat(cfg.datos.map(function (d) { return d.nombre || 'Sin nombre'; }), ['Observaciones'])];
      panel.archivos.forEach(function (a) {
        if (a.estado === 'listo') {
          filas.push([a.nombre, formatoNumero(a.resultado.nota, a.resultado.decimales)]
            .concat(a.resultado.detalles.map(marcaTexto), [a.aviso || '']));
        } else {
          filas.push([a.nombre, ''].concat(cfg.datos.map(function () { return ''; }), [a.error || 'Leyendo…']));
        }
      });
      return filas.map(function (f) {
        return f.map(function (c) { return String(c == null ? '' : c).replace(/[\t\r\n]+/g, ' ').trim(); }).join('\t');
      }).join('\r\n');
    };

    return panel;
  }

  function marcaTexto(d) {
    if (d.fraccion >= 1) return '✓';
    if (d.fraccion <= 0) return '✗';
    return Math.round(d.fraccion * 100) + '%';
  }

  function pintarFragmento(f) {
    return crear('span', { clase: 'fragmento' }, [
      '«' + f.antes,
      crear('mark', { texto: f.hallado || '(vacío)' }),
      f.despues + '»'
    ]);
  }

  function filaResultado(a) {
    var tdArchivo = crear('td', { clase: 'col-archivo', texto: a.nombre });
    var tdNota = crear('td', { clase: 'col-nota' });
    var tdDetalle = crear('td');

    if (a.estado === 'leyendo') {
      tdNota.append(crear('span', { clase: 'nota-pendiente', texto: 'Leyendo…' }));
    } else if (a.estado === 'error') {
      tdNota.append(crear('span', { clase: 'nota-pendiente', texto: '—' }));
      tdArchivo.append(crear('span', { clase: 'nota-error', texto: a.error }));
    } else {
      var r = a.resultado;
      tdNota.append(
        crear('span', { clase: 'nota nota-' + C.nivelNota(r.nota), texto: formatoNumero(r.nota, r.decimales) }),
        crear('span', { clase: 'puntos-detalle', texto: formatoPuntos(r.obtenidos) + ' / ' + formatoPuntos(r.totales) + ' pts' })
      );
      if (a.aviso) tdArchivo.append(crear('span', { clase: 'nota-aviso', texto: '⚠ ' + a.aviso }));
      if (r.detalles.length === 0) tdDetalle.append(crear('span', { clase: 'fragmento', texto: 'No hay criterios configurados.' }));
      var ul = crear('ul', { clase: 'detalle' });
      r.detalles.forEach(function (d) {
        var parcial = d.fraccion > 0 && d.fraccion < 1;
        var pts = parcial ? formatoPuntos(d.obtenido) + ' de ' + formatoPuntos(d.puntos) + ' pts' : formatoPuntos(d.puntos) + ' pts';
        var info = crear('span', null, [crear('b', { texto: d.nombre }), ' (' + pts + ')']);
        if (d.error) info.append(crear('span', { clase: 'fragmento', texto: d.error }));
        else if (d.info) info.append(crear('span', { clase: 'fragmento', texto: d.info }));
        else if (d.fragmento) info.append(pintarFragmento(d.fragmento));
        else info.append(crear('span', { clase: 'fragmento', texto: 'No se encontró.' }));
        var clase = d.fraccion >= 1 ? 'marca-si' : (parcial ? 'marca-parcial' : 'marca-no');
        var simbolo = d.fraccion >= 1 ? '✓' : (parcial ? '◐' : '✗');
        var etiqueta = d.fraccion >= 1 ? 'Cumple' : (parcial ? 'Cumple en parte' : 'No cumple');
        ul.append(crear('li', null, [crear('span', { clase: clase, texto: simbolo, title: etiqueta, 'aria-label': etiqueta }), info]));
      });
      tdDetalle.append(ul);
    }
    return crear('tr', null, [tdArchivo, tdNota, tdDetalle]);
  }

  var panelProfesor = crearPanel({
    cuerpo: $('cuerpo-resultados'), vacio: $('sin-resultados'), resumen: $('resumen'),
    config: function () { return config; }
  });
  var panelAlumno = crearPanel({
    cuerpo: $('cuerpo-alumno'), vacio: $('sin-resultado-alumno'), resumen: $('resumen-alumno'),
    config: configAlumno, unico: true
  });

  /* ---------- Criterios: tarjetas agrupadas, en lenguaje sencillo ---------- */

  function rangoPorDefecto() {
    var p = config.referencia && config.referencia.palabras;
    return p ? Math.round(p * 0.7) + '-' + Math.round(p * 1.3) : '100-500';
  }

  var GRUPOS = [
    {
      id: 'campos', tipos: ['campo'], color: 1,
      titulo: 'Campos que el alumno debe llenar',
      corto: 'Campos',
      ayuda: 'Se revisa que el alumno escriba algo junto a cada campo. «Nombre: Ana» cuenta; «Nombre: ____» no cuenta.',
      vacio: 'No se pide llenar ningún campo.',
      botones: [{ texto: '+ Agregar campo', nuevo: function () { return { nombre: '', buscar: '', tipo: 'campo', puntos: 2 }; } }]
    },
    {
      id: 'secciones', tipos: ['seccion'], color: 2,
      titulo: 'Títulos o apartados que deben aparecer',
      corto: 'Títulos',
      ayuda: 'Se revisa que el documento tenga cada título. No importa si está numerado ni si usa mayúsculas.',
      vacio: 'No se pide ningún título.',
      botones: [{ texto: '+ Agregar título', nuevo: function () { return { nombre: 'Sección: ', buscar: '', tipo: 'seccion', puntos: 2 }; } }]
    },
    {
      id: 'claves', tipos: ['claves'], color: 3,
      titulo: 'Palabras del tema',
      corto: 'Palabras del tema',
      ayuda: 'Palabras importantes que el alumno debería usar. Se dan puntos según cuántas use: si usa 4 de 6, recibe 4/6 de estos puntos. También cuentan las variantes («evaporación» → «evapora»).',
      vacio: 'No se piden palabras del tema.',
      unico: true,
      botones: [{ texto: '+ Pedir palabras del tema', nuevo: function () { return { nombre: 'Palabras clave del tema', buscar: '', tipo: 'claves', puntos: 6 }; } }]
    },
    {
      id: 'longitud', tipos: ['longitud'], color: 4,
      titulo: 'Extensión del trabajo',
      corto: 'Extensión',
      ayuda: 'Cuántas palabras debe tener el trabajo completo.',
      vacio: 'No se revisa la extensión.',
      unico: true,
      botones: [{ texto: '+ Pedir una extensión', nuevo: function () { return { nombre: 'Extensión parecida al modelo', buscar: rangoPorDefecto(), tipo: 'longitud', puntos: 2 }; } }]
    },
    {
      id: 'otros', tipos: ['texto', 'numero', 'fecha', 'patron'], color: 5,
      titulo: 'Otros datos que deben aparecer',
      corto: 'Otros datos',
      ayuda: 'Datos sueltos: una palabra, un número (como la matrícula) o una fecha en cualquier parte del documento.',
      vacio: 'No se piden otros datos.',
      botones: [
        { texto: '+ Palabra o frase', nuevo: function () { return { nombre: '', buscar: '', tipo: 'texto', puntos: 2 }; } },
        { texto: '+ Número (matrícula, teléfono…)', nuevo: function () { return { nombre: 'Matrícula', buscar: '6-10', tipo: 'numero', puntos: 2 }; } },
        { texto: '+ Fecha', nuevo: function () { return { nombre: 'Fecha', buscar: '', tipo: 'fecha', puntos: 2 }; } },
        { texto: '+ Avanzado: expresión regular', avanzado: true, nuevo: function () { return { nombre: '', buscar: '', tipo: 'patron', puntos: 2 }; } }
      ]
    }
  ];

  function grupoDe(tipo) {
    for (var i = 0; i < GRUPOS.length; i++) if (GRUPOS[i].tipos.indexOf(tipo) !== -1) return i;
    return GRUPOS.length - 1;
  }

  /** Ordena los criterios por grupo (orden estable), para que los resultados sigan el mismo orden. */
  function ordenarDatos() {
    config.datos = config.datos
      .map(function (d, i) { return { d: d, g: grupoDe(d.tipo), i: i }; })
      .sort(function (a, b) { return a.g - b.g || a.i - b.i; })
      .map(function (x) { return x.d; });
  }

  // Elementos que muestran cuánto vale cada cosa; se actualizan sin volver a pintar todo.
  var marcadoresPeso = [];

  function totalPuntos() {
    return config.datos.reduce(function (s, d) { return s + (Number(d.puntos) || 0); }, 0);
  }

  function valeDe20(puntos, total) {
    return total > 0 ? formatoNumero((20 * puntos) / total, 1) : '0';
  }

  function actualizarTotal() {
    var total = totalPuntos();
    marcadoresPeso.forEach(function (m) { m.actualizar(total); });
    pintarReparto(total);
  }

  function pintarReparto(total) {
    var cont = $('reparto');
    cont.textContent = '';
    if (total <= 0) {
      cont.append(crear('p', { clase: 'vacio', texto: 'Todavía no hay nada que revisar. Sube un documento modelo o agrega criterios abajo.' }));
      return;
    }
    var barra = crear('div', { clase: 'reparto-barra', role: 'img' });
    var leyenda = crear('ul', { clase: 'reparto-leyenda' });
    var descripcion = [];
    GRUPOS.forEach(function (g) {
      var pts = config.datos.reduce(function (s, d) { return s + (g.tipos.indexOf(d.tipo) !== -1 ? Number(d.puntos) || 0 : 0); }, 0);
      if (pts <= 0) return;
      var vale = valeDe20(pts, total);
      var seg = crear('span', { clase: 'seg color-' + g.color, title: g.corto + ': ' + vale + ' de 20' });
      seg.style.flexGrow = String(pts);
      barra.append(seg);
      leyenda.append(crear('li', null, [crear('span', { clase: 'punto color-' + g.color }), g.corto + ' ', crear('b', { texto: vale })]));
      descripcion.push(g.corto + ' ' + vale);
    });
    barra.setAttribute('aria-label', 'La nota de 20 se reparte así: ' + descripcion.join(', '));
    cont.append(crear('p', { clase: 'reparto-titulo', texto: 'Así se reparte la nota de 20:' }), barra, leyenda);
  }

  /** Campo de texto con etiqueta visible. */
  function campoTexto(etiqueta, valor, placeholder, alCambiar) {
    var input = crear('input', { type: 'text', placeholder: placeholder || '', spellcheck: 'false' });
    input.value = valor;
    input.addEventListener('input', function () { alCambiar(input.value); });
    input.addEventListener('change', cambioConfig);
    return crear('label', { clase: 'campo-criterio' }, [crear('span', { clase: 'etiqueta-campo', texto: etiqueta }), input]);
  }

  /** Número pequeño dentro de una frase («Entre [80] y [148] palabras»). */
  function numeroEnFrase(valor, etiqueta, alCambiar) {
    var input = crear('input', { type: 'number', min: '0', step: '1', inputmode: 'numeric', clase: 'numero-frase', 'aria-label': etiqueta });
    input.value = valor;
    input.addEventListener('input', function () { alCambiar(input.value); });
    input.addEventListener('change', cambioConfig);
    return input;
  }

  /** Editor de palabras como etiquetas: se quitan con × y se agregan escribiendo. */
  function editorPalabras(dato, textoAyuda, alCambiar) {
    var cont = crear('div', { clase: 'editor-palabras' });
    function lista() {
      return String(dato.buscar).split('|').map(function (t) { return t.trim(); }).filter(Boolean);
    }
    function guardar(nueva) {
      dato.buscar = nueva.join('|');
      pintar();
      alCambiar();
      cambioConfig();
    }
    function pintar() {
      cont.textContent = '';
      if (textoAyuda) cont.append(crear('span', { clase: 'etiqueta-campo', texto: textoAyuda }));
      var chips = crear('div', { clase: 'chips' });
      lista().forEach(function (p, i) {
        var quitar = crear('button', { type: 'button', clase: 'chip-quitar', 'aria-label': 'Quitar «' + p + '»', title: 'Quitar', texto: '×' });
        quitar.addEventListener('click', function () {
          var l = lista();
          l.splice(i, 1);
          guardar(l);
        });
        chips.append(crear('span', { clase: 'chip chip-editable' }, [p, quitar]));
      });
      var input = crear('input', { type: 'text', clase: 'chip-nueva', placeholder: 'Escribe una palabra y pulsa Enter', 'aria-label': 'Agregar palabra' });
      var agregar = crear('button', { type: 'button', clase: 'boton boton-secundario boton-chico', texto: 'Agregar' });
      function agregarEscrito() {
        var nuevas = input.value.split(/[|,;\n]/).map(function (t) { return t.trim(); }).filter(Boolean);
        if (!nuevas.length) return;
        var l = lista();
        nuevas.forEach(function (n) {
          if (!l.some(function (x) { return C.normalizar(x) === C.normalizar(n); })) l.push(n);
        });
        guardar(l);
        var nuevoInput = cont.querySelector('.chip-nueva');
        if (nuevoInput) nuevoInput.focus();
      }
      input.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); agregarEscrito(); }
      });
      agregar.addEventListener('click', agregarEscrito);
      chips.append(crear('span', { clase: 'chip-entrada' }, [input, agregar]));
      cont.append(chips);
    }
    pintar();
    return cont;
  }

  /** Contenido de la tarjeta según el tipo, escrito para alguien que no programa. */
  function contenidoCriterio(dato, revisar) {
    var setNombre = function (v) { dato.nombre = v; guardarConfig(); };
    switch (dato.tipo) {
      case 'campo':
        return campoTexto('Nombre del campo', dato.buscar, 'Ej. Nombre del alumno', function (v) {
          dato.buscar = v;
          dato.nombre = v.replace(/[:\s]+$/, '');
          revisar();
          guardarConfig();
        });
      case 'seccion':
        return campoTexto('Título', dato.buscar, 'Ej. Introducción', function (v) {
          dato.buscar = v.replace(/\|/g, ' ');
          dato.nombre = 'Sección: ' + dato.buscar;
          revisar();
          guardarConfig();
        });
      case 'claves':
        return editorPalabras(dato, null, revisar);
      case 'longitud':
        var r = C.rangoLongitud(dato.buscar) || { min: '', max: '' };
        var fijar = function () {
          dato.buscar = minimo.value + '-' + maximo.value;
          revisar();
          guardarConfig();
        };
        var minimo = numeroEnFrase(r.min, 'Mínimo de palabras', fijar);
        var maximo = numeroEnFrase(r.max, 'Máximo de palabras', fijar);
        var ref = config.referencia && config.referencia.palabras;
        return crear('div', null, [
          crear('p', { clase: 'frase' }, ['Entre ', minimo, ' y ', maximo, ' palabras']),
          ref ? crear('span', { clase: 'nota-campo', texto: 'El documento modelo tiene ' + formatoNumero(ref, 0) + ' palabras.' }) : null
        ]);
      case 'numero':
        var c = C.rangoLongitud(dato.buscar) || { min: '', max: '' };
        var fijarCifras = function () {
          dato.buscar = cMin.value + '-' + cMax.value;
          revisar();
          guardarConfig();
        };
        var cMin = numeroEnFrase(c.min, 'Mínimo de cifras', fijarCifras);
        var cMax = numeroEnFrase(c.max, 'Máximo de cifras', fijarCifras);
        return crear('div', { clase: 'pila' }, [
          campoTexto('Qué dato es', dato.nombre, 'Ej. Matrícula', setNombre),
          crear('p', { clase: 'frase' }, ['Un número de ', cMin, ' a ', cMax, ' cifras'])
        ]);
      case 'fecha':
        return crear('div', { clase: 'pila' }, [
          campoTexto('Qué dato es', dato.nombre, 'Ej. Fecha de entrega', setNombre),
          crear('span', { clase: 'nota-campo', texto: 'Cuenta cualquier fecha: 05/03/2025, 2025-03-05 o «5 de marzo».' })
        ]);
      case 'patron':
        return crear('div', { clase: 'pila' }, [
          campoTexto('Qué dato es', dato.nombre, 'Ej. Código del curso', setNombre),
          campoTexto('Expresión regular (solo para usuarios avanzados)', dato.buscar, 'Ej. [A-Z]{3}-\\d+', function (v) {
            dato.buscar = v;
            revisar();
            guardarConfig();
          })
        ]);
      default: // texto
        return crear('div', { clase: 'pila' }, [
          campoTexto('Qué dato es', dato.nombre, 'Ej. Nombre del docente', setNombre),
          editorPalabras(dato, 'Cuenta si aparece cualquiera de estas palabras:', revisar)
        ]);
    }
  }

  /** Botones − y + para el peso, con cuánto vale de la nota de 20. */
  function controlPeso(dato) {
    var input = crear('input', { type: 'number', min: '0', step: '0.5', inputmode: 'decimal', clase: 'peso-valor', 'aria-label': 'Puntos' });
    input.value = dato.puntos;
    var vale = crear('span', { clase: 'vale' });
    function fijar(v, recalcular) {
      v = Number(v);
      dato.puntos = isFinite(v) && v > 0 ? Math.round(v * 2) / 2 : 0;
      guardarConfig();
      actualizarTotal();
      if (recalcular) cambioConfig();
    }
    var menos = crear('button', { type: 'button', clase: 'peso-boton', 'aria-label': 'Menos puntos', texto: '−' });
    var mas = crear('button', { type: 'button', clase: 'peso-boton', 'aria-label': 'Más puntos', texto: '+' });
    menos.addEventListener('click', function () { input.value = Math.max(0, (Number(dato.puntos) || 0) - 1); fijar(input.value, true); });
    mas.addEventListener('click', function () { input.value = (Number(dato.puntos) || 0) + 1; fijar(input.value, true); });
    input.addEventListener('input', function () { fijar(input.value, false); });
    input.addEventListener('change', function () { input.value = dato.puntos; cambioConfig(); });
    marcadoresPeso.push({
      actualizar: function (total) {
        vale.textContent = (Number(dato.puntos) || 0) > 0 ? '≈ ' + valeDe20(dato.puntos, total) + ' de 20' : 'no cuenta';
      }
    });
    return crear('div', { clase: 'peso' }, [
      crear('div', { clase: 'peso-control' }, [menos, input, mas]),
      crear('span', { clase: 'peso-etiqueta', texto: 'puntos' }),
      vale
    ]);
  }

  function tarjetaCriterio(dato) {
    var error = crear('p', { clase: 'error-campo', 'aria-live': 'polite' });
    var tarjeta = crear('div', { clase: 'criterio' });
    function revisar() {
      var msg = C.validarCriterio(dato) || '';
      error.textContent = msg;
      tarjeta.classList.toggle('criterio-invalido', !!msg);
    }
    var quitar = crear('button', { type: 'button', clase: 'criterio-quitar', title: 'Quitar', 'aria-label': 'Quitar «' + (dato.nombre || 'criterio') + '»' });
    quitar.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M4 7h16M10 11v6m4-6v6M6 7l1 12a2 2 0 002 2h6a2 2 0 002-2l1-12M9 7V4h6v3" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    quitar.addEventListener('click', function () {
      config.datos.splice(config.datos.indexOf(dato), 1);
      pintarDatos();
      cambioConfig();
    });
    tarjeta.append(
      crear('div', { clase: 'criterio-cuerpo' }, [contenidoCriterio(dato, revisar), error]),
      controlPeso(dato),
      quitar
    );
    revisar();
    return tarjeta;
  }

  function pintarDatos() {
    marcadoresPeso = [];
    var cont = $('grupos-criterios');
    cont.textContent = '';
    GRUPOS.forEach(function (g) {
      var items = config.datos.filter(function (d) { return g.tipos.indexOf(d.tipo) !== -1; });
      var subtotal = crear('span', { clase: 'grupo-vale' });
      marcadoresPeso.push({
        actualizar: function (total) {
          var pts = items.reduce(function (s, d) { return s + (Number(d.puntos) || 0); }, 0);
          subtotal.textContent = pts > 0 ? 'vale ' + valeDe20(pts, total) + ' de 20' : '';
        }
      });
      var seccion = crear('section', { clase: 'grupo-criterios' }, [
        crear('div', { clase: 'grupo-cabecera' }, [
          crear('h3', null, [crear('span', { clase: 'punto color-' + g.color }), g.titulo + (items.length > 1 ? ' (' + items.length + ')' : '')]),
          subtotal
        ]),
        crear('p', { clase: 'grupo-ayuda', texto: g.ayuda })
      ]);
      if (!items.length) seccion.append(crear('p', { clase: 'grupo-vacio', texto: g.vacio }));
      items.forEach(function (d) { seccion.append(tarjetaCriterio(d)); });

      var botones = g.unico && items.length ? [] : g.botones;
      if (botones.length) {
        seccion.append(crear('div', { clase: 'grupo-botones' }, botones.map(function (b) {
          var boton = crear('button', { type: 'button', clase: b.avanzado ? 'enlace-boton' : 'boton boton-secundario boton-chico', texto: b.texto });
          boton.addEventListener('click', function () {
            config.datos.push(b.nuevo());
            ordenarDatos();
            pintarDatos();
            cambioConfig();
            var tarjetas = $('grupos-criterios').querySelectorAll('.grupo-criterios')[GRUPOS.indexOf(g)].querySelectorAll('.criterio');
            var ultima = tarjetas[tarjetas.length - 1];
            var foco = ultima && ultima.querySelector('input');
            if (foco) foco.focus();
          });
          return boton;
        })));
      }
      cont.append(seccion);
    });
    actualizarTotal();
  }

  function pintarOpciones() {
    document.querySelectorAll('input[name="modo"]').forEach(function (r) { r.checked = r.value === config.modo; });
    $('sel-decimales').value = String(config.decimales);
  }

  function esConfigInicial() {
    return config.datos.length === 0 || JSON.stringify(config.datos) === JSON.stringify(C.configEjemplo().datos);
  }

  /* ---------- Documento modelo ---------- */

  function grupoDetalle(titulo, elementos) {
    if (!elementos.length) return null;
    return crear('div', { clase: 'grupo-detalle' }, [
      crear('span', { clase: 'grupo-titulo', texto: titulo }),
      crear('span', { clase: 'chips' }, elementos.map(function (t) { return crear('span', { clase: 'chip', texto: t }); }))
    ]);
  }

  /** Muestra el resumen del modelo: el indicado o, si no, el guardado en la configuración. */
  function pintarModelo(refMostrar) {
    var ref = refMostrar || config.referencia;
    $('resumen-modelo').hidden = !ref;
    if (!ref) return;
    $('modelo-nombre').textContent = ref.nombre || 'Documento modelo';
    $('m-palabras').textContent = formatoNumero(ref.palabras, 0);
    $('m-parrafos').textContent = formatoNumero(ref.parrafos, 0);
    $('m-campos').textContent = ref.campos;
    $('m-secciones').textContent = ref.secciones;
    $('m-claves').textContent = ref.claves;

    var detalle = $('detalle-modelo');
    detalle.textContent = '';
    var a = analisisModelo;
    if (a) {
      [
        grupoDetalle('Campos a llenar', a.campos.map(function (c) { return c.etiqueta; })),
        grupoDetalle('Secciones', a.secciones),
        grupoDetalle('Palabras clave', a.claves),
        a.longitud ? grupoDetalle('Extensión esperada', ['de ' + a.longitud.min + ' a ' + a.longitud.max + ' palabras']) : null
      ].forEach(function (g) { if (g) detalle.append(g); });
      if (a.aviso) detalle.append(crear('p', { clase: 'nota-aviso', texto: '⚠ ' + a.aviso }));
      if (a.datos.length === 0) {
        detalle.append(crear('p', { clase: 'nota-aviso', texto: 'No se detectaron métricas en este documento. Agrega los criterios a mano en el paso 2.' }));
      }
    }
    $('btn-usar-modelo').hidden = !(a && a.datos.length && !a.aplicado);
  }

  function usarModelo() {
    var a = analisisModelo;
    config.datos = a.datos.map(function (d) { return Object.assign({}, d); });
    config.referencia = Object.assign({}, a.resumen);
    a.aplicado = true;
    ordenarDatos();
    pintarDatos();
    pintarModelo();
    cambioConfig();
    avisar('Se crearon ' + a.datos.length + ' criterios a partir del modelo. Puedes ajustarlos en el paso 2.');
  }

  function recibirModelo(lista) {
    var archivo = lista[0];
    if (!archivo) return;
    avisar('Analizando «' + archivo.name + '»…');
    E.extraer(archivo).then(function (r) {
      analisisModelo = R.analizar(r.texto, { titulos: r.titulos, nombre: archivo.name });
      analisisModelo.aviso = r.aviso;
      if (analisisModelo.datos.length && esConfigInicial()) {
        usarModelo();
      } else {
        // Hay criterios propios: se muestran las métricas y el profesor decide si los reemplaza.
        pintarModelo(analisisModelo.resumen);
        if (analisisModelo.datos.length) avisar('Revisa las métricas y pulsa «Usar estas métricas como criterios».');
      }
    }).catch(function (e) {
      avisar((e && e.message) || 'No se pudo leer el documento.');
    });
  }

  /* ---------- Vista del alumno ---------- */

  /** Lo que se le pide al alumno, como frase. */
  function fraseRequisito(d) {
    var nombre = d.nombre || 'Sin nombre';
    var r;
    switch (d.tipo) {
      case 'campo': return 'Llena el campo «' + String(d.buscar).replace(/[:\s]+$/, '') + '»';
      case 'seccion': return 'Incluye el título «' + d.buscar + '»';
      case 'claves': return 'Usa las ' + C.terminos(d.buscar).length + ' palabras importantes del tema';
      case 'longitud':
        r = C.rangoLongitud(d.buscar);
        return r ? 'Escribe entre ' + r.min + ' y ' + r.max + ' palabras' : nombre;
      case 'numero':
        r = C.rangoLongitud(d.buscar);
        return 'Incluye: ' + nombre + (r ? ' (número de ' + (r.min === r.max ? r.min : r.min + ' a ' + r.max) + ' cifras)' : '');
      case 'fecha': return 'Incluye: ' + nombre;
      default: return 'Incluye: ' + nombre;
    }
  }

  function pintarRequisitos() {
    var cfg = configAlumno();
    var ref = cfg.referencia;
    var origen = $('origen-alumno');
    if (fuenteAlumno.tipo === 'local') {
      origen.textContent = 'Criterios configurados en la vista del profesor de este navegador. Si tu profesor te dio un enlace o un código, úsalo.';
    } else {
      origen.textContent = 'Criterios de tu profesor' + (ref && ref.nombre ? ' (documento modelo: ' + ref.nombre + ')' : '') + '.';
    }
    var lista = $('lista-requisitos');
    lista.textContent = '';
    cfg.datos.forEach(function (d) {
      lista.append(crear('li', null, [
        crear('span', { texto: fraseRequisito(d) }),
        crear('span', { clase: 'req-puntos', texto: formatoPuntos(d.puntos) + ' pts' })
      ]));
    });
    if (!cfg.datos.length) lista.append(crear('li', { texto: 'Todavía no hay criterios.' }));
    $('btn-quitar-codigo').hidden = fuenteAlumno.tipo !== 'codigo';
    $('caja-codigo').hidden = fuenteAlumno.tipo === 'enlace';
  }

  /* ---------- Pestañas ---------- */

  function mostrarVista(vista) {
    var esProfesor = vista === 'profesor' && !modoEnlace;
    $('vista-profesor').hidden = !esProfesor;
    $('vista-alumno').hidden = esProfesor;
    $('pestana-profesor').setAttribute('aria-selected', String(esProfesor));
    $('pestana-alumno').setAttribute('aria-selected', String(!esProfesor));
    $('pestana-profesor').tabIndex = esProfesor ? 0 : -1;
    $('pestana-alumno').tabIndex = esProfesor ? -1 : 0;
    if (!modoEnlace) escribirAlmacen(CLAVE_VISTA, esProfesor ? 'profesor' : 'alumno');
  }

  $('pestana-profesor').addEventListener('click', function () { mostrarVista('profesor'); });
  $('pestana-alumno').addEventListener('click', function () { mostrarVista('alumno'); });
  document.querySelector('.pestanas').addEventListener('keydown', function (e) {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    var otra = document.activeElement === $('pestana-profesor') ? 'alumno' : 'profesor';
    mostrarVista(otra);
    $('pestana-' + otra).focus();
  });

  /* ---------- Eventos del profesor ---------- */

  conectarZona($('zona-modelo'), $('entrada-modelo'), recibirModelo);
  $('btn-usar-modelo').addEventListener('click', function () {
    if (!esConfigInicial() && !confirm('¿Reemplazar los criterios actuales por los del documento modelo?')) return;
    usarModelo();
  });
  $('btn-quitar-modelo').addEventListener('click', function () {
    delete config.referencia;
    analisisModelo = null;
    pintarModelo();
    cambioConfig();
    avisar('Se quitó el modelo. Los criterios se conservan.');
  });

  $('btn-restaurar').addEventListener('click', function () {
    if (!confirm('¿Reemplazar los criterios actuales por los de ejemplo?')) return;
    config.datos = C.configEjemplo().datos;
    delete config.referencia;
    analisisModelo = null;
    pintarDatos();
    pintarModelo();
    cambioConfig();
    avisar('Se restauraron los criterios de ejemplo.');
  });

  document.querySelectorAll('input[name="modo"]').forEach(function (r) {
    r.addEventListener('change', function () { config.modo = r.value; cambioConfig(); });
  });
  $('sel-decimales').addEventListener('change', function () {
    config.decimales = Number($('sel-decimales').value);
    cambioConfig();
  });

  function enlaceAlumnos() {
    return location.href.split('#')[0] + '#alumno=' + C.codificarConfig(config);
  }

  $('aviso-local').hidden = location.protocol !== 'file:';
  $('btn-enlace').addEventListener('click', function () {
    if (!config.datos.length) { avisar('Primero agrega criterios.'); return; }
    copiarTexto(enlaceAlumnos()).then(
      function () { avisar('Enlace copiado. Envíalo a tus alumnos.'); },
      function () { prompt('Copia este enlace:', enlaceAlumnos()); }
    );
  });
  $('btn-codigo').addEventListener('click', function () {
    if (!config.datos.length) { avisar('Primero agrega criterios.'); return; }
    var codigo = C.codificarConfig(config);
    copiarTexto(codigo).then(
      function () { avisar('Código copiado. Los alumnos lo pegan en la pestaña «Alumno».'); },
      function () { prompt('Copia este código:', codigo); }
    );
  });

  $('btn-exportar').addEventListener('click', function () {
    var json = JSON.stringify(config, null, 2);
    $('txt-config').value = json;
    copiarTexto(json).then(
      function () { avisar('Configuración copiada al portapapeles.'); },
      function () { $('txt-config').select(); avisar('Copia el texto seleccionado (Ctrl+C).'); }
    );
  });

  $('btn-importar').addEventListener('click', function () {
    var texto = $('txt-config').value.trim();
    if (!texto) { avisar('Pega primero el texto JSON de la configuración.'); return; }
    try {
      config = C.validarConfig(JSON.parse(texto));
    } catch (e) {
      avisar(e instanceof SyntaxError ? 'El texto no es un JSON válido.' : e.message);
      return;
    }
    analisisModelo = null;
    ordenarDatos();
    pintarDatos();
    pintarOpciones();
    pintarModelo();
    cambioConfig();
    avisar('Configuración importada.');
  });

  conectarZona($('zona-carga'), $('entrada-archivos'), panelProfesor.agregar);

  $('btn-copiar').addEventListener('click', function () {
    if (!panelProfesor.archivos.length) { avisar('No hay resultados que copiar.'); return; }
    copiarTexto(panelProfesor.texto()).then(
      function () { avisar('Tabla copiada. Pégala en Excel con Ctrl+V.'); },
      function () { avisar('No se pudo copiar la tabla.'); }
    );
  });
  $('btn-recalificar').addEventListener('click', function () {
    panelProfesor.recalificar();
    avisar(panelProfesor.archivos.length ? 'Archivos recalificados.' : 'No hay archivos que recalificar.');
  });
  $('btn-limpiar').addEventListener('click', panelProfesor.limpiar);

  /* ---------- Eventos del alumno ---------- */

  conectarZona($('zona-alumno'), $('entrada-alumno'), panelAlumno.agregar);
  $('btn-limpiar-alumno').addEventListener('click', panelAlumno.limpiar);

  $('btn-usar-codigo').addEventListener('click', function () {
    var texto = $('txt-codigo').value.trim();
    if (!texto) { avisar('Pega primero el código de tu profesor.'); return; }
    try {
      fuenteAlumno = { tipo: 'codigo', config: C.decodificarConfig(texto) };
    } catch (e) {
      avisar(e.message);
      return;
    }
    $('txt-codigo').value = '';
    pintarRequisitos();
    panelAlumno.recalificar();
    avisar('Código aplicado.');
  });
  $('btn-quitar-codigo').addEventListener('click', function () {
    fuenteAlumno = { tipo: 'local', config: null };
    pintarRequisitos();
    panelAlumno.recalificar();
  });

  // Si se pega otro enlace en la misma pestaña, se recarga para leerlo.
  window.addEventListener('hashchange', function () { location.reload(); });

  /* ---------- Inicio ---------- */

  if (modoEnlace) {
    document.body.classList.add('modo-enlace');
    $('pie-enlace').hidden = false;
    $('pie-enlace').querySelector('a').href = location.href.split('#')[0];
  }
  ordenarDatos();
  pintarDatos();
  pintarOpciones();
  pintarModelo();
  pintarRequisitos();
  panelProfesor.pintar();
  panelAlumno.pintar();
  mostrarVista(modoEnlace ? 'alumno' : (leerAlmacen(CLAVE_VISTA) || 'profesor'));
})();
