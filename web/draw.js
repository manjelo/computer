// Freehand pen on a canvas, shared by the AI track and the team collection page.

const PEN_WIDTH = 14;

export function attachPen(canvas, { onStroke }) {
  const context = canvas.getContext("2d");
  let last = null;

  function toCanvas(event) {
    const box = canvas.getBoundingClientRect();
    return {
      x: ((event.clientX - box.left) / box.width) * canvas.width,
      y: ((event.clientY - box.top) / box.height) * canvas.height,
    };
  }

  function line(from, to) {
    context.strokeStyle = "#12233b";
    context.lineWidth = PEN_WIDTH;
    context.lineCap = "round";
    context.lineJoin = "round";
    context.beginPath();
    context.moveTo(from.x, from.y);
    context.lineTo(to.x, to.y);
    context.stroke();
  }

  canvas.addEventListener("pointerdown", (event) => {
    canvas.setPointerCapture(event.pointerId);
    last = toCanvas(event);
    line(last, last);
  });

  canvas.addEventListener("pointermove", (event) => {
    if (!last) return;
    const point = toCanvas(event);
    line(last, point);
    last = point;
  });

  function finish() {
    if (!last) return;
    last = null;
    onStroke();
  }
  canvas.addEventListener("pointerup", finish);
  canvas.addEventListener("pointercancel", finish);

  return {
    clear() {
      context.clearRect(0, 0, canvas.width, canvas.height);
    },
    toPng() {
      return new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
    },
  };
}
