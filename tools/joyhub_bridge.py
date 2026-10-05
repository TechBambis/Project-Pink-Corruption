#!/usr/bin/env python3
# SPDX-FileCopyrightText: 2026 BambiOS
# SPDX-License-Identifier: AGPL-3.0-only
# Separate commercial permissions: see LICENSING.md.

"""Local BlueZ/Bleak bridge. No cloud, accounts, GUI or media-analysis packages.

Motor packet layout verified against jeahbwoi720/Joyhub-Bluetooth-Controller.
Channel roles depend on the device; this tool does not infer a rotation opcode.
"""
import argparse,asyncio,json,math,signal,time

PROTOCOL='bambi-joyhub/1'
STOP=bytes.fromhex('a00300000000aa')

def motor_packet(percentages):
    if not isinstance(percentages,list) or len(percentages)!=4:raise ValueError('Four motor channels required')
    if any(isinstance(x,bool) or not isinstance(x,(int,float)) or not math.isfinite(x) or not 0<=x<=100 for x in percentages):raise ValueError('Channels must be finite percentages')
    return bytes([0xa0,0x03]+[int(x*255/100) for x in percentages]+[0xaa])

class Bridge(asyncio.DatagramProtocol):
    def __init__(self,clock=time.monotonic):
        self.transport=None;self.client=None;self.characteristic=None;self.response=False
        self.device='';self.error='BLE not connected';self.latest=STOP;self.updated=0.;self.clock=clock
        self.last_sent=None;self.armed=False;self.write_lock=asyncio.Lock()
        self.write_count=0;self.last_nonzero=None;self.last_nonzero_at=0.
    def connection_made(self,transport):self.transport=transport
    def datagram_received(self,data,peer):
        if peer[0]!='127.0.0.1' or len(data)>2048:return
        try:
            if data.strip()==b'STOP':self.latest=STOP;self.updated=self.clock();return
            packet=json.loads(data)
            if not isinstance(packet,dict):return
            if packet.get('status') is True:
                status=dict(protocol=PROTOCOL,connected=bool(self.armed and self.client and self.client.is_connected),device=self.device,error=self.error,writeCount=self.write_count,lastNonzeroPacket=self.last_nonzero,lastNonzeroAgeSeconds=round(self.clock()-self.last_nonzero_at,2) if self.last_nonzero else None)
                self.transport.sendto(json.dumps(status).encode(),peer)
            if 'vibe' in packet:
                # Ignore commands received before BLE has been zeroed/armed.
                self.latest=motor_packet(packet['vibe']) if self.armed else STOP
                self.updated=self.clock()
        except (ValueError,TypeError,UnicodeError):pass
    def target(self):return STOP if not self.armed or self.clock()-self.updated>1.5 else self.latest
    async def write(self,payload):
        async with self.write_lock:
            await asyncio.wait_for(self.client.write_gatt_char(self.characteristic,payload,response=self.response),timeout=2)
            self.write_count+=1
            if payload!=STOP:self.last_nonzero=payload.hex();self.last_nonzero_at=self.clock()
    async def pump(self,done):
        while not done.is_set():
            if self.client and self.client.is_connected and self.armed:
                payload=self.target()
                if payload!=self.last_sent:
                    try:await self.write(payload);self.last_sent=payload
                    except Exception as error:
                        self.error=str(error)[:200];self.armed=False;self.latest=STOP
                        try:await self.client.disconnect()
                        except Exception:pass
            await asyncio.sleep(.01)

async def writable(client):
    return [c for service in client.services for c in service.characteristics if 'write' in c.properties or 'write-without-response' in c.properties]

async def connect_loop(bridge,address,write_char,done):
    from bleak import BleakClient
    while not done.is_set():
        bridge.armed=False;bridge.latest=STOP;bridge.last_sent=None
        try:
            async with BleakClient(address,timeout=15) as client:
                bridge.client=client;bridge.device=address
                candidates=await writable(client)
                selected=client.services.get_characteristic(write_char) if write_char else candidates[0] if len(candidates)==1 else None
                if not selected or selected not in candidates:
                    bridge.error='Specify --write-char. Writable UUIDs: '+', '.join(c.uuid for c in candidates)
                    print(json.dumps({'error':bridge.error}),flush=True)
                    return
                bridge.characteristic=selected;bridge.response='write-without-response' not in selected.properties
                # Never replay an old nonzero target after reconnect.
                await bridge.write(STOP);bridge.latest=STOP;bridge.updated=bridge.clock();bridge.last_sent=STOP;bridge.error='';bridge.armed=True
                print(json.dumps({'connected':True,'device':address,'writeChar':selected.uuid}),flush=True)
                while client.is_connected and not done.is_set():await asyncio.sleep(.2)
                if client.is_connected:
                    try:await bridge.write(STOP)
                    except Exception:pass
        except Exception as error:
            bridge.error=str(error)[:200];print(json.dumps({'connected':False,'error':bridge.error}),flush=True)
        finally:bridge.armed=False;bridge.client=None;bridge.latest=STOP
        try:await asyncio.wait_for(done.wait(),timeout=3)
        except TimeoutError:pass

async def run(args):
    from bleak import BleakScanner,BleakClient
    if args.scan:
        devices=await BleakScanner.discover(timeout=args.seconds,return_adv=True)
        print(json.dumps([{'address':device.address,'name':advertisement.local_name or device.name or '', 'rssi':advertisement.rssi} for device,advertisement in devices.values()],indent=2))
        return
    if args.describe:
        async with BleakClient(args.address,timeout=15) as client:
            print(json.dumps([{'uuid':c.uuid,'properties':c.properties} for c in await writable(client)],indent=2))
        return
    done=asyncio.Event();loop=asyncio.get_running_loop()
    for sig in (signal.SIGINT,signal.SIGTERM):
        try:loop.add_signal_handler(sig,done.set)
        except (NotImplementedError,RuntimeError):pass
    bridge=Bridge()
    transport,_=await loop.create_datagram_endpoint(lambda:bridge,local_addr=('127.0.0.1',8888))
    print(json.dumps({'bridge':PROTOCOL,'listening':'127.0.0.1:8888','watchdogSeconds':1.5}),flush=True)
    connection=asyncio.create_task(connect_loop(bridge,args.address,args.write_char,done));pump=asyncio.create_task(bridge.pump(done))
    try:await done.wait()
    finally:
        done.set();bridge.latest=STOP
        if bridge.client and bridge.client.is_connected:
            try:await bridge.write(STOP)
            except Exception:pass
        await asyncio.gather(connection,pump,return_exceptions=True);transport.close()

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--scan',action='store_true');parser.add_argument('--seconds',type=float,default=8)
    parser.add_argument('--address');parser.add_argument('--write-char');parser.add_argument('--describe',action='store_true')
    args=parser.parse_args()
    if not args.scan and not args.address:parser.error('--address required; use --scan first')
    try:asyncio.run(run(args))
    except (KeyboardInterrupt,SystemExit):raise
    except Exception as error:parser.exit(1,f'Local BLE bridge unavailable: {error}\n')
if __name__=='__main__':main()
