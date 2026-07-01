// test_presentation.js
const PptxGenJS = require('pptxgenjs');

let pptx = new PptxGenJS();

// Slide 1: Title Slide
let slide1 = pptx.addSlide();
slide1.addText("Test Presentation", {
    x: 1, y: 1, w: 8, h: 1,
    fontSize: 36, bold: true, align: 'center', color: '363636'
});
slide1.addText("Generated for Testing", {
    x: 1, y: 2.5, w: 8, h: 0.5,
    fontSize: 18, align: 'center', color: '666666'
});

// Slide 2: Bullet Points
let slide2 = pptx.addSlide();
slide2.addText("Key Features", {
    x: 0.5, y: 0.5, w: 9, h: 0.5,
    fontSize: 24, bold: true, color: '363636'
});
slide2.addText("\u2022 Feature 1: Basic functionality\n\u2022 Feature 2: Performance testing\n\u2022 Feature 3: Compatibility check\n\u2022 Feature 4: User feedback", {
    x: 0.5, y: 1.2, w: 9, h: 2,
    fontSize: 18, color: '444444'
});

// Slide 3: Chart Placeholder
let slide3 = pptx.addSlide();
slide3.addText("Data Overview", {
    x: 0.5, y: 0.5, w: 9, h: 0.5,
    fontSize: 24, bold: true, color: '363636'
});
slide3.addText("[Chart/Image Placeholder]", {
    x: 1, y: 1.5, w: 8, h: 3,
    fontSize: 18, align: 'center', color: '888888'
});
slide3.addShape(pptx.ShapeType.rect, {
    x: 2, y: 2, w: 6, h: 2,
    fill: { color: 'f1f1f1' }, line: { color: 'cccccc' }
});

// Slide 4: Summary
let slide4 = pptx.addSlide();
slide4.addText("Summary", {
    x: 0.5, y: 0.5, w: 9, h: 0.5,
    fontSize: 24, bold: true, color: '363636'
});
slide4.addText("\u2022 Tested core features\n\u2022 Identified improvements\n\u2022 Next steps: Deployment", {
    x: 0.5, y: 1.2, w: 9, h: 2,
    fontSize: 18, color: '444444'
});
slide4.addText("Questions?", {
    x: 0.5, y: 3.5, w: 9, h: 0.5,
    fontSize: 20, bold: true, align: 'center', color: '363636'
});

// Save the presentation
pptx.writeFile("Test_Presentation").then(() => {
    console.log("Presentation generated: Test_Presentation.pptx");
});