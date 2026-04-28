const audio=document.getElementById('audio');
const track=document.getElementById('subtitleTrack');
let subtitles=[{start:1,end:3,text:'測試字幕'}];
let pxPerSecond=100;
let dragging=null;

function render(){
track.innerHTML='';
subtitles.forEach((s,i)=>{
let div=document.createElement('div');
div.className='clip';
div.style.left=(s.start*pxPerSecond)+'px';
div.style.width=((s.end-s.start)*pxPerSecond)+'px';
div.dataset.index=i;
div.innerHTML=`
<div class="handle left"></div>
<div class="text">${s.text}</div>
<div class="handle right"></div>`;
div.querySelector('.left').onmousedown=e=>startResize(e,'left');
div.querySelector('.right').onmousedown=e=>startResize(e,'right');
div.onmousedown=startDrag;
track.appendChild(div);
});
}

function startDrag(e){
dragging={type:'move',index:e.currentTarget.dataset.index,startX:e.clientX,
origStart:subtitles[e.currentTarget.dataset.index].start,
origEnd:subtitles[e.currentTarget.dataset.index].end};
document.onmousemove=onDrag;
document.onmouseup=stop;
}

function startResize(e,type){
e.stopPropagation();
let i=e.currentTarget.parentElement.dataset.index;
dragging={type:type,index:i,startX:e.clientX,
origStart:subtitles[i].start,
origEnd:subtitles[i].end};
document.onmousemove=onResize;
document.onmouseup=stop;
}

function onDrag(e){
let d=(e.clientX-dragging.startX)/pxPerSecond;
let s=subtitles[dragging.index];
s.start=Math.max(0,dragging.origStart+d);
s.end=dragging.origEnd+d;
render();
}

function onResize(e){
let d=(e.clientX-dragging.startX)/pxPerSecond;
let s=subtitles[dragging.index];
if(dragging.type==='left'){
s.start=Math.max(0,dragging.origStart+d);
if(s.start>s.end-0.1)s.start=s.end-0.1;
}
if(dragging.type==='right'){
s.end=dragging.origEnd+d;
if(s.end<s.start+0.1)s.end=s.start+0.1;
}
render();
}

function stop(){
document.onmousemove=null;
document.onmouseup=null;
dragging=null;
}

render();
