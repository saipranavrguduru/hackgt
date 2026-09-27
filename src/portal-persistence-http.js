import {Readable} from 'node:stream';

// Portal identity is committed before publishing a successful response or cookie.
// API handlers currently use complete JSON responses, never streaming responses.
const bodyError=(status,code,message)=>Object.assign(new Error(message),{status,code});
function collectBody(req,timeoutMs) {
  return new Promise((resolve,reject)=>{
    const chunks=[];let length=0,settled=false,timer;
    const complete=error=>{
      if(settled)return;settled=true;clearTimeout(timer);
      for(const [event,listener] of listeners)req.removeListener(event,listener);
      if(error){req.pause();reject(error);}else resolve(Buffer.concat(chunks,length));
    };
    const interrupted=()=>complete(bodyError(400,'REQUEST_ABORTED','Request body was interrupted.'));
    const listeners=[
      ['data',chunk=>{
        const bytes=Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk);length+=bytes.length;
        if(length>65536){complete(bodyError(413,'BODY_TOO_LARGE','Request exceeds the allowed body size.'));return;}
        chunks.push(bytes);
      }],
      ['end',()=>complete()],['error',interrupted],['aborted',interrupted],['close',interrupted]
    ];
    if(req.destroyed || req.aborted){interrupted();return;}
    for(const [event,listener] of listeners)req.on(event,listener);
    timer=setTimeout(()=>complete(bodyError(408,'REQUEST_TIMEOUT','Request body took too long. Please try again.')),timeoutMs);
  });
}

function rejectBody(req,res,error) {
  // Flush the small error first, then close the incomplete request/socket. A
  // client that disconnects before flush still releases the paused request.
  const close=()=>{res.removeListener?.('close',close);req.destroy();};
  res.once?.('close',close);
  res.writeHead(error.status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','Connection':'close'});
  res.end(JSON.stringify({error:{code:error.code,message:error.message}}),close);
}

function bufferedResponse() {
  const headers=new Map();
  return {
    statusCode:200,writableEnded:false,body:undefined,
    setHeader(name,value){headers.set(name.toLowerCase(),value);},
    getHeader(name){return headers.get(name.toLowerCase());},
    removeHeader(name){headers.delete(name.toLowerCase());},
    writeHead(status,values={}){this.statusCode=status;for(const [name,value] of Object.entries(values))this.setHeader(name,value);return this;},
    end(body){this.body=body;this.writableEnded=true;return this;},
    flush(res){for(const [name,value] of headers)res.setHeader(name,value);res.writeHead(this.statusCode);res.end(this.body);}
  };
}

class PortalResponseError extends Error {
  constructor(response){super('Portal request rejected.');this.response=response;}
}

export function withPortalPersistence(persistence,handler,{bodyTimeoutMs=10000}={}) {
  const timeout=Number.isFinite(bodyTimeoutMs)&&bodyTimeoutMs>0?bodyTimeoutMs:10000;
  return async(req,res)=>{
    let pathname;
    try{pathname=new URL(req.url,'http://portal.invalid').pathname;}
    catch{res.writeHead(400,{'Content-Type':'application/json'});res.end('{"error":{"code":"INVALID_URL","message":"Invalid request URL."}}');return;}
    if(!pathname?.startsWith('/api/') || ['/api/health','/api/v1/health','/api/v1/agent-checkout/webhooks/stripe'].includes(pathname))return handler(req,res);
    let request=req;
    if(['POST','PATCH','DELETE'].includes(req.method)){
      let body;try{body=await collectBody(req,timeout);}catch(error){rejectBody(req,res,error);return;}
      // The domain handlers retain their own JSON, origin, auth and stricter
      // body-size validation; no parsing or identity checks move outside them.
      request=Object.assign(Readable.from([body]),{url:req.url,headers:req.headers,method:req.method,socket:req.socket});
    }
    const response=bufferedResponse();
    try {
      await persistence.run(async()=>{
        await handler(request,response);
        if(!response.writableEnded)throw new Error('Portal response was incomplete.');
        if(response.statusCode>=400 && response.commitErrorResponse!==true)throw new PortalResponseError(response);
      });
      response.flush(res);
    } catch(error) {
      if(error instanceof PortalResponseError){error.response.removeHeader('Set-Cookie');error.response.flush(res);return;}
      res.writeHead(503,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});
      res.end(JSON.stringify({error:{code:'PORTAL_STORAGE_UNAVAILABLE',message:'Account storage is temporarily unavailable. Please try again.'}}));
    } finally {
      if(request!==req)request.destroy();
    }
  };
}
