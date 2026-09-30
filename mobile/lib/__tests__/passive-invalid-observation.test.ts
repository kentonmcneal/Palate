import AsyncStorage from "@react-native-async-storage/async-storage";
import { qualifyVisit, recordForClustering } from "../passive-pipeline";
import type { RawVisit } from "../passive-capture";
const end=Date.UTC(2026,8,29,18);
const raw=(patch:Record<string,unknown>={}):RawVisit=>({id:"synthetic",lat:40.75,lng:-73.99,horizontalAccuracy:10,arrivalAt:end-15*60000,departureAt:end,capturedAt:end,simulated:true,source:"stop",...patch} as RawVisit);
beforeEach(async()=>{jest.clearAllMocks();await AsyncStorage.clear();});
const invalid:Record<string,unknown>[]=[
 {lat:NaN},{lat:Infinity},{lat:90.01},{lat:-90.01},{lng:NaN},{lng:180.01},{lng:-180.01},{lat:"40.75"},{lng:null},
 {horizontalAccuracy:NaN},{horizontalAccuracy:Infinity},{horizontalAccuracy:-1},{horizontalAccuracy:"10"},
 {arrivalAt:NaN},{departureAt:NaN},{arrivalAt:Infinity},{departureAt:Infinity},{arrivalAt:String(end-900000)},{departureAt:String(end)},
 {arrivalAt:9e15,departureAt:9e15+900000},{capturedAt:NaN},{capturedAt:Infinity},{capturedAt:"now"},
];
it.each(invalid)("rejects malformed observation %j before history reads",async(patch)=>{
 const get=jest.spyOn(AsyncStorage,"getItem").mockClear();
 await expect(qualifyVisit(raw(patch))).resolves.toEqual({ok:false,reason:"invalid-observation"});expect(get).not.toHaveBeenCalled();
});
it.each(invalid)("malformed observation %j cannot teach history",async(patch)=>{
 const set=jest.spyOn(AsyncStorage,"setItem").mockClear();await recordForClustering(raw(patch));expect(set).not.toHaveBeenCalled();
});
it.each([{lat:0,lng:0},{lat:90,lng:180},{lat:-90,lng:-180},{horizontalAccuracy:0},{horizontalAccuracy:100},{horizontalAccuracy:500,source:"slc"}])("keeps valid boundary %j",async(patch)=>{await expect(qualifyVisit(raw(patch))).resolves.toEqual({ok:true,dwellMin:15});});
it("preserves open visit and source-specific accuracy behavior",async()=>{
 await expect(qualifyVisit(raw({departureAt:null}))).resolves.toEqual({ok:false,reason:"open-visit"});
 await expect(qualifyVisit(raw({horizontalAccuracy:101}))).resolves.toEqual({ok:false,reason:"low-accuracy"});
 await expect(qualifyVisit(raw({horizontalAccuracy:501,source:"slc"}))).resolves.toEqual({ok:false,reason:"low-accuracy"});
});
it("preserves short, long and reversed duration rejection",async()=>{
 await expect(qualifyVisit(raw({arrivalAt:end-4*60000}))).resolves.toEqual({ok:false,reason:"dwell-too-short"});
 await expect(qualifyVisit(raw({arrivalAt:end-241*60000}))).resolves.toEqual({ok:false,reason:"dwell-too-long"});
 await expect(qualifyVisit(raw({arrivalAt:end+60000}))).resolves.toEqual({ok:false,reason:"dwell-too-short"});
});
