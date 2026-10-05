# SPDX-FileCopyrightText: 2026 BambiOS
# SPDX-License-Identifier: AGPL-3.0-only
# Separate commercial permissions: see LICENSING.md.

import asyncio,importlib.util,json,unittest
from pathlib import Path
spec=importlib.util.spec_from_file_location('bridge',Path(__file__).resolve().parents[1]/'tools/joyhub_bridge.py');module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)

class BridgeTests(unittest.TestCase):
    def test_verified_motor_packet_and_invalid_percentages(self):
        self.assertEqual(module.motor_packet([30,20,0,0]),bytes.fromhex('a0034c330000aa'))
        self.assertEqual(module.motor_packet([0,0,0,0]),module.STOP)
        for values in ([101,0,0,0],[-1,0,0,0],[float('nan'),0,0,0],[True,0,0,0],[0,0]):
            with self.assertRaises(ValueError):module.motor_packet(values)
    def test_disconnected_commands_are_not_replayed_and_watchdog_zeros(self):
        clock=[10.];bridge=module.Bridge(lambda:clock[0]);bridge.datagram_received(b'{"vibe":[30,20,0,0]}',('127.0.0.1',50000));self.assertEqual(bridge.target(),module.STOP)
        bridge.armed=True;bridge.datagram_received(b'{"vibe":[30,20,0,0]}',('127.0.0.1',50000));self.assertNotEqual(bridge.target(),module.STOP)
        clock[0]=11.6;self.assertEqual(bridge.target(),module.STOP)
        bridge.datagram_received(b'{"vibe":[30,20,0,0]}',('192.0.2.1',50000));self.assertEqual(bridge.target(),module.STOP)
        bridge.datagram_received(b'STOP',('127.0.0.1',50000));self.assertEqual(bridge.target(),module.STOP)
    def test_local_status_reply_does_not_refresh_watchdog(self):
        clock=[10.];bridge=module.Bridge(lambda:clock[0]);replies=[]
        class Transport:
            def sendto(self,data,peer):replies.append(json.loads(data))
        bridge.connection_made(Transport());bridge.datagram_received(b'{"status":true}',('127.0.0.1',50000));self.assertEqual(replies[0]['connected'],False);self.assertEqual(bridge.updated,0)
class WriteDiagnosticsTests(unittest.IsolatedAsyncioTestCase):
    async def test_write_diagnostics_require_successful_gatt_write(self):
        bridge=module.Bridge(lambda:10.)
        class Client:
            async def write_gatt_char(self,*args,**kwargs):pass
        bridge.client=Client();await bridge.write(module.STOP)
        self.assertEqual(bridge.write_count,1);self.assertIsNone(bridge.last_nonzero)
        await bridge.write(module.motor_packet([20,0,0,0]));self.assertEqual(bridge.last_nonzero,'a00333000000aa')
        class FailedClient:
            async def write_gatt_char(self,*args,**kwargs):raise RuntimeError('not connected')
        bridge.client=FailedClient()
        with self.assertRaises(RuntimeError):await bridge.write(module.STOP)
        self.assertEqual(bridge.write_count,2)
if __name__=='__main__':unittest.main()

