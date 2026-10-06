for(const button of document.querySelectorAll('[data-copy-brief]')){
  button.addEventListener('click',async()=>{
    const text=document.getElementById(button.dataset.copyBrief);
    const status=document.getElementById(button.dataset.copyStatus);
    try{
      if(!navigator.clipboard?.writeText)throw Error('Clipboard unavailable');
      await navigator.clipboard.writeText(text.value);
      status.textContent='Copied. Paste the brief into your agent and replace the project description.';
    }catch{
      text.focus();text.select();
      status.textContent='The brief is selected. Use your device’s copy command, then paste it into your agent.';
    }
  });
}
