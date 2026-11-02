'use strict';
module.exports = async function({c, verify, eventually}) {
 const acknowledge = async () => {await eventually('__designPending.length===1');await c.evaluate(String.raw`__designReply('tournament_edit_props')`);};
 await c.evaluate(String.raw`window.__inkOriginal=structuredClone(curt.certificate_design.single.fields.find(field=>field.id==='name'));window.__certificateInkImages=[];window.__certificateInkGaps=[]`);
 for (const [text, height] of [['1. Platz', 22], ['Änne Günther\nJörg Müller', 35]]) {
  await c.evaluate(`__designSet('textarea',${JSON.stringify(text)},'input');__designSet('[aria-label="Schriftgröße (pt)"]','36');__designSet('[name="certificate_field_height"]',${JSON.stringify(String(height / 10))})`);await acknowledge();
  await eventually(`document.querySelector('[data-field-id="name"]').textContent===${JSON.stringify(text.replace(/\n/g, ''))}`);
  await c.evaluate(String.raw`(async()=>{
   const group=__designPage().querySelector('[data-field-id="name"]'),field=curt.certificate_design.single.fields.find(field=>field.id==='name'),MM=btsCertificateDesign.MM,scale=8,padding=10;
   await document.fonts.load('700 100px "BTS Certificate Sans"');
   const preview=document.createElement('canvas');preview.width=Math.ceil(field.width*scale);preview.height=Math.ceil((field.height+padding*2)*scale);
   const context=preview.getContext('2d');context.fillStyle='#ffffff';context.fillRect(0,0,preview.width,preview.height);context.fillStyle='#000000';
   for(const node of group.querySelectorAll('text')){const style=getComputedStyle(node);context.font=style.fontWeight+' '+Number(node.getAttribute('font-size'))*scale+'px '+style.fontFamily;context.fillText(node.textContent,(Number(node.getAttribute('x'))-field.x)*scale,(Number(node.getAttribute('y'))-field.y+padding)*scale);}
   const gaps=canvas=>{const pixels=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;let top=Infinity,bottom=-Infinity;for(let y=0;y<canvas.height;y++)for(let x=0;x<canvas.width;x++){const i=(y*canvas.width+x)*4;if(pixels[i]<100&&pixels[i+1]<100&&pixels[i+2]<100){top=Math.min(top,y);bottom=Math.max(bottom,y);}}return {top:top-padding*scale,bottom:(padding+field.height)*scale-bottom-1};};
   window.__inkPreviewGaps=gaps(preview);
   const design=structuredClone(curt.certificate_design);design.single.fields=[{...field,color:'#000000'}];design.single.background=null;
   const data=await btsCertificateDocument.createPdf(design,[{kind:'single'}]),lib=await import('/static/vendor/pdfjs/pdf.min.mjs');lib.GlobalWorkerOptions.workerSrc='/static/vendor/pdfjs/pdf.worker.min.mjs';
   const task=lib.getDocument({data,isEvalSupported:false});let crop;
   try{const pdf=await task.promise,page=await pdf.getPage(1),viewport=page.getViewport({scale:scale/MM}),canvas=document.createElement('canvas');canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);await page.render({canvasContext:canvas.getContext('2d'),viewport}).promise;crop=document.createElement('canvas');crop.width=preview.width;crop.height=preview.height;crop.getContext('2d').drawImage(canvas,field.x*scale,(field.y-padding)*scale,crop.width,crop.height,0,0,crop.width,crop.height);}finally{await task.destroy();}
   window.__inkPdfGaps=gaps(crop);__certificateInkGaps.push({text:field.text,preview:__inkPreviewGaps,pdf:__inkPdfGaps});
   for(const canvas of [preview,crop]){const pen=canvas.getContext('2d');pen.strokeStyle='#31575f';pen.strokeRect(.5,padding*scale+.5,canvas.width-1,field.height*scale-1);}
   __certificateInkImages.push({text:field.text,preview:preview.toDataURL(),pdf:crop.toDataURL()});
  })()`);
  const label = text.includes('\n') ? 'multiline accented text' : '1. Platz';
  await verify('Visible preview glyph pixels are vertically centered for '+label,String.raw`Number.isFinite(__inkPreviewGaps.top)&&__inkPreviewGaps.top>=0&&__inkPreviewGaps.bottom>=0&&Math.abs(__inkPreviewGaps.top-__inkPreviewGaps.bottom)<=2`);
  await verify('Rasterized PDF glyph pixels are vertically centered for '+label,String.raw`Number.isFinite(__inkPdfGaps.top)&&__inkPdfGaps.top>=0&&__inkPdfGaps.bottom>=0&&Math.abs(__inkPdfGaps.top-__inkPdfGaps.bottom)<=2`);
 }
 await c.evaluate(String.raw`__designSet('textarea',__inkOriginal.text,'input');__designSet('[aria-label="Schriftgröße (pt)"]',String(__inkOriginal.size));__designSet('[name="certificate_field_height"]',String(__inkOriginal.height/10))`);await acknowledge();
};
