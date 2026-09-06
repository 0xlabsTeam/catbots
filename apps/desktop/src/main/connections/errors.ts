export class ConnectionError extends Error {
 constructor(readonly code:string){super(code);this.name='ConnectionError';}
}
export function approvalRejection(value:unknown):ConnectionError {
 const text=typeof value==='string'?value.toLowerCase():'';
 const code=/must deposit|deposit before|user does not exist|account does not exist/.test(text)?'CONNECTION_ACCOUNT_NOT_ACTIVATED'
 :/too many|maximum.*agent|agent.*limit/.test(text)?'CONNECTION_AGENT_LIMIT'
 :/nonce|expired/.test(text)?'CONNECTION_AUTHORIZATION_EXPIRED'
 :/signature|signer/.test(text)?'CONNECTION_SIGNATURE_REJECTED'
 :'CONNECTION_AUTHORIZATION_REJECTED';
 return new ConnectionError(code);
}
