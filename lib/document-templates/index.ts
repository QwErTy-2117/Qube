export const EXCEL_TEMPLATE = `When generating Excel spreadsheets, follow these conventions:
- Use clear, descriptive column headers in Title Case
- Choose appropriate data types for each column (text, number, date, currency)
- Organize related data on separate sheets
- Include a header row with proper formatting
- Avoid merged cells where possible
- Use consistent number formatting within columns
- Include totals or summaries where helpful
- Limit sheets to reasonable row counts`;

export const DOCX_TEMPLATE = `When generating Word documents, follow these conventions:
- Use a clear heading hierarchy: Title (H1), sections (H2), subsections (H3)
- Keep paragraphs focused on single topics
- Use bullet lists for items without inherent order
- Use numbered lists for sequential steps or ranked items
- Include a brief introductory paragraph
- End with a conclusion or summary where appropriate
- Use consistent formatting throughout`;

export const PPTX_TEMPLATE = `When generating PowerPoint presentations, follow these conventions:
- Aim for 5-12 slides depending on content depth
- Each slide should cover one main idea
- Use bullet points, not full paragraphs
- Include a title slide and a summary/conclusion slide
- Keep text concise and scannable
- Use section slides for multi-part presentations
- Avoid more than 6-8 bullet points per slide
- Include data visualizations where helpful`;
