import {fail,requireValue} from './errors.js';

export function resolveCheckoutOrigin({origin,env=process.env,port}={}) {
  const value=origin || env.CHECKOUT_ORIGIN || env.PUBLIC_ORIGIN || env.RENDER_EXTERNAL_URL || `http://localhost:${port ?? env.PORT ?? 3000}`;
  let parsed;
  try{parsed=new URL(value);}catch{fail('INVALID_CHECKOUT_ORIGIN','Configure an exact HTTPS or loopback HTTP checkout origin.',503);}
  const loopback=['localhost','127.0.0.1','[::1]'].includes(parsed.hostname);
  requireValue(parsed.origin===value && !parsed.username && !parsed.password &&
    (parsed.protocol==='https:' || parsed.protocol==='http:' && loopback),
    'INVALID_CHECKOUT_ORIGIN','Checkout requires an exact HTTPS or loopback HTTP origin without credentials, path, query, or fragment.',503);
  return value;
}
