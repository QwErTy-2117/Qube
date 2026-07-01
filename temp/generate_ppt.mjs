// generate_ppt.mjs
import PptxGenJS from "pptxgenjs";
const pptx = new PptxGenJS();

// Slide 1: Title Slide
let slide1 = pptx.addSlide();
slide1.addText("Testing PowerPoint", {
x: 1, y: 1, w: 8, h: 1, fontSize: 24, bold: true, align: "center"
});
slide1.addText("Generated for Testing Purposes", {
x: 1, y: 2, w: 8, h: 1, fontSize: 18, align: "center"
});

// Slide 2: Bullet Points
let slide2 = pptx.addSlide();
slide2.addText("Key Features Tested:", {
x: 1, y: 0.5, w: 8, h: 1, fontSize: 18, bold: true
});
slide2.addText(
  ["• Slide creation", "• Text formatting", "• Bullet points", "• Charts and visuals"],
  { x: 1, y: 1.5, w: 8, h: 2, fontSize: 16 }
);

// Slide 3: Simple Chart
let slide3 = pptx.addSlide();
slide3.addText("Sample Chart", {
x: 1, y: 0.5, w: 8, h: 1, fontSize: 18, bold: true
});
let chartData = [
  { name: "Test 1", labels: ["A", "B", "C"], values: [10, 20, 30] },
];
slide3.addChart(pptx.ChartType.bar, chartData, { x: 1, y: 1.5, w: 8, h: 4 });

// Save the PPT
pptx.writeFile("Testing_Presentation.pptx").then(() => {
  console.log("PPT generated: Testing_Presentation.pptx");
});