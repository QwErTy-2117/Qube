// generate_ppt.js
const PptxGenART = require('pptxgenjs');

let pptx = new PptxGenART();

// Slide 1: Title Slide
let slide1 = pptx.addSlide();
slide1.addText("Test PowerPoint Presentation", {
x: 1, y: 1, w: 8, h: 1, fontSize: 24, bold: true, align: 'center'
});
slide1.addText("For Testing Purposes", {
x: 1, y: 2, w: 8, h: 1, fontSize: 18, align: 'center'
});

// Slide 2: Bullet Points
let slide2 = pptx.addSlide();
slide2.addText("Key Features", {
x: 0.5, y: 0.5, w: 5, h: 0.5, fontSize: 18, bold: true
});
slide2.addText(
  ["Slide 1: Title Slide", "Slide 2: Bullet Points", "Slide 3: Chart", "Slide 4: Image Placeholder"],
  { x: 0.5, y: 1, w: 8, h: 4, fontSize: 14, bullet: true }
);

// Slide 3: Simple Chart
let slide3 = pptx.addSlide();
slide3.addText("Sample Data", {
x: 0.5, y: 0.5, w: 5, h: 0.5, fontSize: 18, bold: true
});
let chartData = [
  { name: "Test 1", labels: ["A", "B", "C"], values: [10, 20, 30] },
];
slide3.addChart(pptx.ChartType.bar, chartData, { x: 1, y: 1, w: 8, h: 4 });

// Slide 4: Image Placeholder
let slide4 = pptx.addSlide();
slide4.addText("Image Placeholder", {
x: 0.5, y: 0.5, w: 5, h: 0.5, fontSize: 18, bold: true
});
slide4.addShape(pptx.ShapeType.rect, { x: 2, y: 2, w: 4, h: 3, fill: { color: "D3D3D3" } });
slide4.addText("Image Here", { x: 2, y: 3.5, w: 4, h: 1, align: 'center' });

// Save the PPT
pptx.writeFile("Test_Presentation.pptx").then(() => {
  console.log("PowerPoint generated successfully!");
});