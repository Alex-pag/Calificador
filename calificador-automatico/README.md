# Calificador automático

Página web para calificar trabajos **del 0 al 20** comparándolos con un **documento modelo** del profesor.

- **Vista del profesor:** sube su documento modelo. La página obtiene sus **métricas clave** (campos a llenar, secciones, palabras clave y extensión) y con ellas crea los criterios de calificación. El profesor puede ajustarlos, compartirlos con los alumnos y calificar muchos trabajos de una vez.
- **Vista del alumno:** sube su documento y ve su nota y lo que le falta para parecerse al modelo.

Funciona solo con HTML, CSS y JavaScript: **no necesita servidor ni base de datos**. Los archivos se leen dentro del navegador y **no se envían a ningún lado**.

## Cómo usarlo

### Profesor

1. Abre `index.html` (o la página publicada) y entra en la pestaña **Profesor**.
2. **Documento modelo:** sube el documento con el formato que deben seguir los alumnos. Verás sus métricas y se crearán los criterios automáticamente.
3. **Criterios de calificación:** revisa la tabla. Puedes cambiar puntos, quitar criterios o agregar otros.
4. **Forma de calificar y compartir:** elige el modo y los decimales, y pulsa **Copiar enlace para alumnos** (o **Copiar código**) para enviárselo a tus alumnos.
5. **Calificar trabajos de alumnos:** si los alumnos te entregan los archivos, súbelos todos juntos. Con **Copiar tabla** pegas los resultados en Excel o Google Sheets.

### Alumno

1. Abre el **enlace** que te dio tu profesor. Solo verás la vista del alumno, con la lista de lo que debe tener tu documento.
   (Si te dio un **código**, abre la pestaña **Alumno** y pégalo en «¿Tu profesor te dio un código?»).
2. Sube tu documento.
3. Verás tu nota y, para cada criterio, si lo cumples (✓), si lo cumples en parte (◐) o si te falta (✗).

> El enlace solo funciona en otros equipos si la página está publicada en internet (por ejemplo, con GitHub Pages). Si la abres como archivo desde tu computadora, usa el código.
> La primera carga necesita internet para descargar JSZip y pdf.js desde cdnjs.

## Métricas clave que se obtienen del modelo

| Métrica | Qué se detecta en el modelo | Qué se le pide al alumno | Puntos iniciales |
|---|---|---|---|
| **Campos a llenar** | Líneas como «Nombre del alumno: ______» o «Grupo: 3B» (etiqueta de 1 a 4 palabras y valor corto). | Que tenga la etiqueta **y que esté llena** («Nombre: ____» no cuenta). | 2 c/u |
| **Secciones** | Títulos con estilo de título en Word/LibreOffice, encabezados `#` en Markdown, `<h1>`–`<h6>` en HTML y títulos de diapositiva. En PDF y texto: líneas cortas numeradas, en MAYÚSCULAS o seguidas de un párrafo largo. | Que el título aparezca (la numeración no importa). | 2 c/u |
| **Palabras clave** | Hasta 10 palabras que más se repiten en el modelo (sin palabras comunes como «para» o «este»). | Que las use. Da puntos parciales: 4 de 6 palabras = 4/6 de los puntos. Acepta variantes: «evaporación» cuenta si escribe «evapora». | 6 |
| **Extensión** | Número de palabras del modelo. | Entre 30 % menos y 30 % más palabras que el modelo. | 2 |

Los puntos son relativos: la nota siempre es 20 × puntos obtenidos ÷ puntos totales.

## Cómo se calcula la nota

| Modo | Regla |
|---|---|
| **Proporcional** (predeterminado) | nota = 20 × puntos obtenidos ÷ puntos totales. Cada criterio que falte resta sus puntos. |
| **Todo o nada** | si falta cualquier criterio (o una palabra clave), la nota es 0; si se cumplen todos, es 20. |

La nota se puede mostrar con 0, 1 o 2 decimales. Colores: **verde** ≥ 14, **amarillo** ≥ 10, **rojo** < 10.

## Cómo ajustar lo que se revisa (paso 2)

Los criterios aparecen en tarjetas, agrupados y en lenguaje sencillo; no hace falta saber programar:

| Grupo | Qué escribe el profesor |
|---|---|
| **Campos que el alumno debe llenar** | El nombre del campo, por ejemplo «Puesto que está solicitando». |
| **Títulos o apartados** | El título, por ejemplo «DATOS PERSONALES». |
| **Palabras del tema** | Las palabras, como etiquetas: se quitan con **×** y se agregan escribiendo y pulsando Enter (se pueden pegar varias separadas por comas). |
| **Extensión del trabajo** | «Entre ___ y ___ palabras». |
| **Otros datos** | Una palabra o frase (cuenta cualquiera de las que escribas), un número con cierta cantidad de cifras (matrícula, teléfono…) o una fecha en cualquier formato. |

- Cada tarjeta tiene botones **−** y **+** para darle más o menos peso, y muestra cuánto vale de la nota de 20 (por ejemplo «≈ 1.3 de 20»).
- Arriba, una barra de colores muestra cómo se reparte la nota entre los grupos.
- Cada grupo tiene su propio botón para agregar. El ícono de bote de basura quita un criterio.
- La búsqueda **no distingue mayúsculas ni acentos**: «matricula» encuentra «MATRÍCULA».
- Para usuarios avanzados queda la opción **«Avanzado: expresión regular»** en «Otros datos». Si la expresión tiene un error, la tarjeta se marca en rojo y ese criterio cuenta como no cumplido, pero la página sigue funcionando.

Sin documento modelo, la página empieza con criterios de ejemplo (nombre del alumno, matrícula, fecha, grupo/grado y nombre del docente, 4 puntos cada uno). **Volver a los criterios de ejemplo** los restaura. Las configuraciones guardadas con versiones anteriores, que usaban expresiones regulares para los campos, la matrícula y la fecha, se convierten solas a estas tarjetas.

## Formatos que acepta

| Formato | Cómo se lee |
|---|---|
| `.docx` (Word) | Texto, encabezados, pies de página y notas. Detecta los títulos por su estilo. |
| `.xlsx` (Excel) | Todas las hojas. Las fechas se convierten a dd/mm/aaaa. |
| `.pptx` (PowerPoint) | Diapositivas y notas. Los títulos de diapositiva cuentan como secciones. |
| `.odt` (LibreOffice) | Texto y títulos. |
| `.pdf` | Texto de todas las páginas. |
| `.txt`, `.csv`, `.md`, `.json` | Texto tal cual (UTF-8 o Windows-1252). |
| `.html` | Texto visible de la página. |

- **PDF escaneado:** si casi no tiene texto (es una foto o un escaneo), aparece un aviso. Pide el archivo original o pásalo por un programa de reconocimiento de texto (OCR).
- **Formatos antiguos** `.doc`, `.xls`, `.ppt`: no se pueden leer. La página pide guardarlos como `.docx`, `.xlsx` o `.pptx`.

## Guardar y compartir la configuración

- La configuración del profesor se guarda sola en el navegador (`localStorage`). Si el navegador no lo permite (por ejemplo, en modo privado), la página funciona igual, pero no recuerda los cambios.
- **Enlace / código para alumnos:** llevan dentro los criterios (no el documento modelo). Si cambias los criterios, copia y envía el enlace de nuevo.
- **Exportar / importar (JSON):** para guardar la configuración o pasarla a otro docente.

## Limitaciones

- Compara **contenido y formato**, no la calidad: no sabe si las respuestas son correctas. Un alumno que copie el modelo y llene los campos sacará 20.
- Las métricas se detectan con reglas sencillas. Revisa siempre los criterios generados: a veces se detecta como campo o sección algo que no lo es, o falta alguno.
- Los campos se detectan mejor si en el modelo están en líneas propias o separados por tabulador o guiones bajos («Nombre: ____ ⇥ Grupo: ____»).
- Las variantes de palabras clave se reconocen por la raíz («evaporación», «evapora»), pero no detecta sinónimos.
- Como se ignoran los acentos, la «ñ» se trata como «n».
- No lee texto dentro de imágenes (PDF escaneados, fotos pegadas en Word), ni cuadros de texto de las diapositivas maestras, ni comentarios de Word.
- Un alumno con conocimientos técnicos podría ver los criterios dentro del enlace.
- Un patrón muy mal escrito (por ejemplo `(a+)+`) puede hacer que la página tarde mucho con archivos grandes.

## Estructura

```
index.html          Página principal (vistas Profesor y Alumno)
css/styles.css      Estilos (modo claro/oscuro automático, adaptable a celular)
js/calificador.js   Lógica de calificación y código para compartir (sin dependencias)
js/referencia.js    Análisis del documento modelo: métricas clave → criterios
js/extractor.js     Lectura de archivos (JSZip y pdf.js)
js/app.js           Interfaz
tests/              Pruebas de la calificación y del análisis del modelo
```

## Pruebas

Requieren [Node.js](https://nodejs.org/) 18 o superior y no instalan nada:

```bash
npm test
# o bien
node --test tests/
```
