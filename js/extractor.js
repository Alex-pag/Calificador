/*
 * extractor.js — Obtiene el texto de los archivos subidos.
 * Usa JSZip (Office / OpenDocument) y pdf.js (PDF), cargados desde cdnjs.
 * Expone window.Extractor.
 */
(function (global) {
  'use strict';

  var PDF_WORKER = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  var MIN_CARACTERES_PDF = 20; // menos de esto se considera PDF escaneado

  var EXTENSIONES = ['docx', 'pdf', 'xlsx', 'pptx', 'odt', 'txt', 'csv', 'md', 'html', 'htm', 'json'];
  var ANTIGUOS = { doc: 'docx', xls: 'xlsx', ppt: 'pptx' };

  function extension(nombre) {
    var m = /\.([^.]+)$/.exec(String(nombre || ''));
    return m ? m[1].toLowerCase() : '';
  }

  /* ---------- utilidades XML ---------- */

  function decodificarEntidades(s) {
    return s
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&#x([0-9a-f]+);/gi, function (_, h) { return codigo(parseInt(h, 16)); })
      .replace(/&#(\d+);/g, function (_, d) { return codigo(parseInt(d, 10)); })
      .replace(/&amp;/g, '&');
  }

  function codigo(n) {
    try { return String.fromCodePoint(n); } catch (e) { return ''; }
  }

  function quitarEtiquetas(xml) {
    return decodificarEntidades(xml.replace(/<[^>]+>/g, ''));
  }

  function limpiarLineas(texto) {
    return texto
      .split('\n')
      .map(function (l) {
        // Se conserva un tabulador (separa campos como «Nombre: ___ ⇥ Grupo: ___»).
        return l.replace(/[  ]*\t[ \t ]*/g, '\t').replace(/[  ]+/g, ' ').trim();
      })
      .filter(function (l, i, arr) { return l || (i > 0 && arr[i - 1]); })
      .join('\n')
      .trim();
  }

  /** Lee los archivos de un ZIP que cumplen el filtro, en orden natural. */
  function leerZip(buffer, filtro) {
    if (typeof global.JSZip === 'undefined') {
      return Promise.reject(new Error('No se pudo cargar JSZip. Revisa tu conexión a internet y recarga la página.'));
    }
    return global.JSZip.loadAsync(buffer)
      .catch(function () {
        throw new Error('El archivo está dañado o no es un documento válido.');
      })
      .then(function (zip) {
        var nombres = Object.keys(zip.files).filter(filtro).sort(ordenNatural);
        return Promise.all(nombres.map(function (n) { return zip.file(n).async('string'); }))
          .then(function (contenidos) {
            return { zip: zip, nombres: nombres, contenidos: contenidos };
          });
      });
  }

  function ordenNatural(a, b) {
    return a.localeCompare(b, undefined, { numeric: true });
  }

  function unicos(lista) {
    var vistos = {};
    return lista
      .map(function (t) { return t.replace(/\s+/g, ' ').trim(); })
      .filter(function (t) {
        var k = t.toLowerCase();
        if (!t || vistos[k]) return false;
        vistos[k] = true;
        return true;
      });
  }

  /** Títulos de Word: párrafos con estilo Título / Heading. */
  function titulosDocx(xml) {
    var titulos = [];
    (xml.match(/<w:p\b[^>]*>[\s\S]*?<\/w:p>/g) || []).forEach(function (p) {
      var estilo = /<w:pStyle\s+w:val="([^"]+)"/.exec(p);
      if (estilo && /^(heading|t\S*tulo|title|subt)/i.test(estilo[1])) {
        titulos.push(quitarEtiquetas(p.replace(/<w:tab\/>/g, ' ')));
      }
    });
    return titulos;
  }

  /* ---------- formatos ---------- */

  function extraerDocx(buffer) {
    var filtro = function (n) {
      return /^word\/(header\d*|document|footnotes|endnotes|footer\d*)\.xml$/.test(n);
    };
    return leerZip(buffer, filtro).then(function (r) {
      if (!r.nombres.some(function (n) { return n === 'word/document.xml'; })) {
        throw new Error('No parece un documento de Word (.docx) válido.');
      }
      var titulos = titulosDocx(r.contenidos[r.nombres.indexOf('word/document.xml')]);
      var texto = r.contenidos.map(function (xml) {
        xml = xml
          .replace(/<w:instrText[\s\S]*?<\/w:instrText>/g, '')
          .replace(/<w:delText[\s\S]*?<\/w:delText>/g, '')
          .replace(/<w:tab\/>/g, '\t')
          .replace(/<w:(br|cr)\b[^>]*\/>/g, '\n')
          .replace(/<\/w:p>/g, '\n');
        return quitarEtiquetas(xml);
      }).join('\n');
      return { texto: limpiarLineas(texto), titulos: unicos(titulos) };
    });
  }

  function extraerPptx(buffer) {
    var filtro = function (n) {
      return /^ppt\/(slides\/slide|notesSlides\/notesSlide)\d+\.xml$/.test(n);
    };
    return leerZip(buffer, filtro).then(function (r) {
      if (r.nombres.length === 0) throw new Error('La presentación no tiene diapositivas o no es un .pptx válido.');
      var titulos = [];
      r.contenidos.forEach(function (xml, i) {
        if (r.nombres[i].indexOf('notesSlide') !== -1) return;
        (xml.match(/<p:sp\b[\s\S]*?<\/p:sp>/g) || []).forEach(function (sp) {
          if (/<p:ph\b[^>]*type="(title|ctrTitle)"/.test(sp)) {
            titulos.push(quitarEtiquetas(sp.replace(/<a:br\b[^>]*\/>/g, ' ').replace(/<\/a:p>/g, ' ')));
          }
        });
      });
      var texto = r.contenidos.map(function (xml) {
        return quitarEtiquetas(xml.replace(/<a:br\b[^>]*\/>/g, '\n').replace(/<\/a:p>/g, '\n'));
      }).join('\n');
      return { texto: limpiarLineas(texto), titulos: unicos(titulos) };
    });
  }

  function extraerOdt(buffer) {
    var filtro = function (n) { return n === 'content.xml' || n === 'styles.xml'; };
    return leerZip(buffer, filtro).then(function (r) {
      if (r.nombres.indexOf('content.xml') === -1) throw new Error('No parece un documento .odt válido.');
      var titulos = (r.contenidos[r.nombres.indexOf('content.xml')].match(/<text:h\b[^>]*>[\s\S]*?<\/text:h>/g) || [])
        .map(function (h) { return quitarEtiquetas(h.replace(/<text:(s|tab)\b[^>]*\/>/g, ' ')); });
      var texto = r.contenidos.map(function (xml) {
        xml = xml
          .replace(/<text:tab\b[^>]*\/>/g, '\t')
          .replace(/<text:s\b[^>]*\/>/g, ' ')
          .replace(/<text:line-break\b[^>]*\/>/g, '\n')
          .replace(/<\/text:(p|h)>/g, '\n');
        return quitarEtiquetas(xml);
      }).join('\n');
      return { texto: limpiarLineas(texto), titulos: unicos(titulos) };
    });
  }

  /* Excel: los formatos de fecha integrados y los personalizados con d/m/y. */
  var FORMATOS_FECHA = [14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 30, 36, 45, 46, 47, 50, 57];

  function estilosDeFecha(stylesXml) {
    var personalizados = {};
    (stylesXml.match(/<numFmt\b[^>]*\/>/g) || []).forEach(function (tag) {
      var id = /numFmtId="(\d+)"/.exec(tag);
      var code = /formatCode="([^"]*)"/.exec(tag);
      if (id && code) personalizados[id[1]] = decodificarEntidades(code[1]);
    });
    var esFecha = function (id) {
      if (FORMATOS_FECHA.indexOf(Number(id)) !== -1) return true;
      var c = personalizados[id];
      if (!c) return false;
      c = c.replace(/"[^"]*"/g, '').replace(/\[[^\]]*\]/g, '');
      return /[dy]/i.test(c) || /m{3,}/i.test(c);
    };
    var bloque = /<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/.exec(stylesXml);
    var lista = [];
    if (bloque) {
      (bloque[1].match(/<xf\b[^>]*>/g) || []).forEach(function (xf) {
        var id = /numFmtId="(\d+)"/.exec(xf);
        lista.push(id ? esFecha(id[1]) : false);
      });
    }
    return lista;
  }

  function serialAFecha(serial) {
    var ms = Math.round((serial - 25569) * 86400000); // 25569 = 1970-01-01
    var d = new Date(ms);
    var dd = String(d.getUTCDate()).padStart(2, '0');
    var mm = String(d.getUTCMonth() + 1).padStart(2, '0');
    return dd + '/' + mm + '/' + d.getUTCFullYear();
  }

  function extraerXlsx(buffer) {
    var filtro = function (n) {
      return /^xl\/(sharedStrings|styles)\.xml$/.test(n) || /^xl\/worksheets\/sheet\d+\.xml$/.test(n);
    };
    return leerZip(buffer, filtro).then(function (r) {
      var compartidas = [];
      var fechas = [];
      var hojas = [];
      r.nombres.forEach(function (n, i) {
        var xml = r.contenidos[i];
        if (n === 'xl/sharedStrings.xml') {
          compartidas = (xml.match(/<si\b[\s\S]*?<\/si>/g) || []).map(function (si) {
            var partes = si.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '').match(/<t\b[^>]*>[\s\S]*?<\/t>/g) || [];
            return partes.map(quitarEtiquetas).join('');
          });
        } else if (n === 'xl/styles.xml') {
          fechas = estilosDeFecha(xml);
        } else {
          hojas.push(xml);
        }
      });
      if (hojas.length === 0) throw new Error('El libro no tiene hojas o no es un .xlsx válido.');

      var texto = hojas.map(function (xml) {
        var filas = xml.match(/<row\b[\s\S]*?<\/row>/g) || [];
        return filas.map(function (fila) {
          var celdas = [];
          var re = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
          var m;
          while ((m = re.exec(fila))) {
            var attrs = m[1];
            var cuerpo = m[2] || '';
            var tipo = (/\bt="([^"]+)"/.exec(attrs) || [])[1];
            var estilo = (/\bs="(\d+)"/.exec(attrs) || [])[1];
            var v = /<v>([\s\S]*?)<\/v>/.exec(cuerpo);
            var valor = '';
            if (tipo === 's' && v) valor = compartidas[Number(v[1])] || '';
            else if (tipo === 'inlineStr') valor = quitarEtiquetas((/<is>([\s\S]*?)<\/is>/.exec(cuerpo) || ['', ''])[1]);
            else if (v) {
              valor = decodificarEntidades(v[1]);
              if (!tipo && estilo && fechas[Number(estilo)] && isFinite(Number(valor))) {
                valor = serialAFecha(Number(valor));
              }
            }
            if (valor !== '') celdas.push(valor);
          }
          return celdas.join('\t');
        }).join('\n');
      }).join('\n');
      return { texto: limpiarLineas(texto) };
    });
  }

  function extraerPdf(buffer) {
    var pdfjs = global.pdfjsLib;
    if (!pdfjs) {
      return Promise.reject(new Error('No se pudo cargar pdf.js. Revisa tu conexión a internet y recarga la página.'));
    }
    if (!pdfjs.GlobalWorkerOptions.workerSrc) pdfjs.GlobalWorkerOptions.workerSrc = PDF_WORKER;

    return pdfjs.getDocument({ data: new Uint8Array(buffer) }).promise
      .catch(function (e) {
        if (e && e.name === 'PasswordException') throw new Error('El PDF está protegido con contraseña.');
        throw new Error('No se pudo abrir el PDF (puede estar dañado).');
      })
      .then(function (pdf) {
        var paginas = [];
        for (var i = 1; i <= pdf.numPages; i++) paginas.push(i);
        return Promise.all(paginas.map(function (n) {
          return pdf.getPage(n).then(function (p) { return p.getTextContent(); }).then(function (tc) {
            return tc.items.map(function (it) { return (it.str || '') + (it.hasEOL ? '\n' : ''); }).join('');
          });
        })).then(function (textos) {
          var texto = limpiarLineas(textos.join('\n'));
          var aviso = null;
          if (texto.replace(/\s/g, '').length < MIN_CARACTERES_PDF) {
            aviso = 'El PDF casi no tiene texto: probablemente es un documento escaneado (imagen). ' +
              'Pide el archivo original o pásalo por un programa de reconocimiento de texto (OCR).';
          }
          return { texto: texto, aviso: aviso };
        });
      });
  }

  /** Lee texto plano probando UTF-8 y, si falla, Windows-1252 (Excel en español). */
  function leerTextoPlano(buffer) {
    var bytes = new Uint8Array(buffer);
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^﻿/, '');
    } catch (e) {
      return new TextDecoder('windows-1252').decode(bytes);
    }
  }

  function extraerHtml(buffer) {
    var doc = new DOMParser().parseFromString(leerTextoPlano(buffer), 'text/html');
    doc.querySelectorAll('script, style, noscript, template').forEach(function (n) { n.remove(); });
    doc.querySelectorAll('br').forEach(function (n) { n.replaceWith('\n'); });
    doc.querySelectorAll('p, div, li, tr, h1, h2, h3, h4, h5, h6, section, article').forEach(function (n) {
      n.append('\n');
    });
    var titulos = Array.prototype.map.call(doc.querySelectorAll('h1, h2, h3, h4, h5, h6'), function (h) {
      return h.textContent;
    });
    var titulo = doc.title ? doc.title + '\n' : '';
    return { texto: limpiarLineas(titulo + (doc.body ? doc.body.textContent : '')), titulos: unicos(titulos) };
  }

  function extraerMarkdown(buffer) {
    var texto = leerTextoPlano(buffer);
    var titulos = [];
    texto.split(/\r?\n/).forEach(function (l) {
      var m = /^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/.exec(l);
      if (m) titulos.push(m[1].replace(/[*_`]/g, ''));
    });
    return { texto: texto, titulos: unicos(titulos) };
  }

  /**
   * Extrae el texto de un File.
   * @returns {Promise<{texto: string, aviso: string|null, titulos: string[]}>}
   * titulos: los títulos marcados como tales en el documento (vacío si el formato no los indica).
   */
  function extraer(archivo) {
    var ext = extension(archivo.name);
    if (ANTIGUOS[ext]) {
      return Promise.reject(new Error(
        'El formato .' + ext + ' es antiguo y no se puede leer. Abre el archivo y guárdalo como .' +
        ANTIGUOS[ext] + ' (Archivo → Guardar como).'
      ));
    }
    if (EXTENSIONES.indexOf(ext) === -1) {
      return Promise.reject(new Error(
        ext ? 'El formato .' + ext + ' no es compatible.' : 'El archivo no tiene extensión.'
      ));
    }
    return archivo.arrayBuffer().then(function (buffer) {
      switch (ext) {
        case 'docx': return extraerDocx(buffer);
        case 'pptx': return extraerPptx(buffer);
        case 'xlsx': return extraerXlsx(buffer);
        case 'odt': return extraerOdt(buffer);
        case 'pdf': return extraerPdf(buffer);
        case 'html':
        case 'htm': return extraerHtml(buffer);
        case 'md': return extraerMarkdown(buffer);
        default: return { texto: leerTextoPlano(buffer) };
      }
    }).then(function (r) {
      var aviso = r.aviso || null;
      if (!aviso && !r.texto.trim()) aviso = 'El archivo no contiene texto.';
      return { texto: r.texto, aviso: aviso, titulos: r.titulos || [] };
    });
  }

  global.Extractor = {
    EXTENSIONES: EXTENSIONES,
    extension: extension,
    extraer: extraer
  };
})(typeof self !== 'undefined' ? self : this);
