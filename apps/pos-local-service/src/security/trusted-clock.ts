import type { LocalDatabase } from "@pos-platform/database-sqlite";
export class TrustedClockGuard {
  constructor(private readonly database:LocalDatabase,private readonly rollbackToleranceMs=300_000){}
  accept(now:Date):void{
    const current=now.toISOString();
    const transaction=this.database.native.transaction(()=>{
      const row=this.database.native.prepare("SELECT last_trusted_time FROM local_security_state WHERE singleton=1").get() as {last_trusted_time:string}|undefined;
      if(row&&now.getTime()+this.rollbackToleranceMs<Date.parse(row.last_trusted_time))throw new Error("local clock rollback rejected");
      if(!row||now.getTime()>Date.parse(row.last_trusted_time)){
        this.database.native.prepare(`INSERT INTO local_security_state(singleton,last_trusted_time) VALUES(1,?)
          ON CONFLICT(singleton) DO UPDATE SET last_trusted_time=excluded.last_trusted_time`).run(current);
      }
    }); transaction();
  }
}
