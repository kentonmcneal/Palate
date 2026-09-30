import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import {getInbox} from '../passive-confirm';
import {scheduleDigest} from '../passive-digest';
import {INBOX_EXPIRY_HOURS} from '../passive-inbox-policy';
jest.mock('../analytics',()=>({track:jest.fn()}));
jest.mock('../observability',()=>({captureError:jest.fn()}));
jest.mock('../passive-inbox-sync',()=>({mirrorInbox:jest.fn(),hydrateInboxIfEmpty:jest.fn()}));
jest.mock('../visits',()=>({recentlyPrompted:async()=>false,placeRefusals:async()=>0,shouldDemote:()=>false}));
jest.mock('../eating-pattern',()=>({loadEatingPattern:async()=>null}));
jest.mock('expo-notifications',()=>({getAllScheduledNotificationsAsync:jest.fn().mockResolvedValue([]),cancelScheduledNotificationAsync:jest.fn(),scheduleNotificationAsync:jest.fn().mockResolvedValue('offline'),SchedulableTriggerInputTypes:{DATE:'date'}}));
const H=3600000,K='palate.passive.inbox';
const low=(at:Date,id='coffee')=>({id,place_id:id,name:id,address:'',alternates:[],detectedAt:+at,dwellMin:8,confidenceBand:'low'});
beforeEach(async()=>{jest.clearAllMocks();await AsyncStorage.clear()});
afterEach(()=>jest.restoreAllMocks());
async function run(now:Date,entries:ReturnType<typeof low>[]){
 jest.spyOn(Date,'now').mockReturnValue(+now);await AsyncStorage.setItem(K,JSON.stringify(entries));
 await scheduleDigest(await getInbox(),async()=>null,async()=>{},now);
 expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledTimes(1);
 const request=(Notifications.scheduleNotificationAsync as jest.Mock).mock.calls[0][0];
 const when=request.trigger.date as Date;expect(+when).toBeGreaterThan(+now);
 (Date.now as jest.Mock).mockReturnValue(+when+1);
 return {when,live:await getInbox(),request};
}
it.each([
 ['Friday pre-midnight capture',new Date(2026,8,25,0,10),new Date(2026,8,24,23,55),new Date(2026,8,26)],
 ['Friday exact boundary',new Date(2026,8,25),new Date(2026,8,25),new Date(2026,8,26)],
 ['year boundary',new Date(2027,0,1,0,10),new Date(2026,11,31,23,55),new Date(2027,0,2)],
] as const)('%s actual schedule remains readable just after delivery',async(_,now,capture,expected)=>{
 const {when,live,request}=await run(now,[low(capture)]);expect(+when).toBe(+expected);expect(live.map(x=>x.id)).toEqual(['coffee']);expect(request.content.categoryIdentifier).toBeUndefined();
});
it('mixed old/new preserves both shown entries at delivery',async()=>{
 const now=new Date(2026,8,25,1);const {when,live}=await run(now,[low(now,'fresh'),low(new Date(2026,8,24,22),'old')]);expect(+when).toBe(+new Date(2026,8,26));expect(live.map(x=>x.id).sort()).toEqual(['fresh','old']);
});
it('ordinary Monday deferral retained with actual reader',async()=>{
 const {when,live}=await run(new Date(2026,8,21,19),[low(new Date(2026,8,21,13))]);expect(+when).toBe(+new Date(2026,8,22,21));expect(live).toHaveLength(1);
});
it.each([[2026,2,7],[2026,9,31]] as const)('DST weekend %i/%i/%i uses local calendar and elapsed retention',async(y,m,d)=>{
 const now=new Date(y,m,d,12),capture=new Date(y,m,d,11);const {when,live}=await run(now,[low(capture)]);expect(+when).toBe(+new Date(y,m,d+1,21));expect(+when-(+capture)).toBeLessThan(48*H);expect(live).toHaveLength(1);
});
it('actual read expiry is inclusive at exactly 48h and prunes 1ms later',async()=>{
 const at=new Date(2026,8,21,13);await AsyncStorage.setItem(K,JSON.stringify([low(at)]));const clock=jest.spyOn(Date,'now').mockReturnValue(+at+INBOX_EXPIRY_HOURS*H);expect(await getInbox()).toHaveLength(1);clock.mockReturnValue(+at+INBOX_EXPIRY_HOURS*H+1);expect(await getInbox()).toEqual([]);expect(JSON.parse((await AsyncStorage.getItem(K))!)).toEqual([]);
});
