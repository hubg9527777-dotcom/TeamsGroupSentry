/* Validates the untrusted, user-selected encrypted backup envelope before
 * decoding Base64 or allocating decrypted buffers. No secrets are logged. */
(function(root,factory){const value=factory();if(typeof module==='object'&&module.exports)module.exports=value;root.TGSBackupEnvelope=value;})(globalThis,()=>{
  const MAX_INPUT_BYTES=45*1024*1024;
  // Portable for the browser support floor (Chrome/Edge 120+).
  function base64(field,minBytes,maxBytes,label){
    if(typeof field!=='string'||field.length<4||field.length%4!==0||field.length>Math.ceil(maxBytes/3)*4+4||
       !/^[A-Za-z0-9+/]+={0,2}$/.test(field))throw new Error(`${label} 的 Base64 格式或长度无效`);
    const padding=field.endsWith('==')?2:field.endsWith('=')?1:0;
    const bytes=field.length/4*3-padding;
    if(bytes<minBytes||bytes>maxBytes)throw new Error(`${label} 长度超限`);
    return field;
  }
  function validate(value){
    if(!value||typeof value!=='object'||Array.isArray(value)||
       value.format!=='TGS3_ENCRYPTED'||value.version!==1||
       value.iterations!==250000||value.kdf!=='PBKDF2-SHA256'||value.cipher!=='AES-256-GCM')
      throw new Error('不支持的加密备份格式');
    base64(value.salt,16,16,'盐');
    base64(value.iv,12,12,'随机 IV');
    base64(value.data,16,MAX_INPUT_BYTES,'密文');
    return value;
  }
  return Object.freeze({validate,MAX_INPUT_BYTES});
});
