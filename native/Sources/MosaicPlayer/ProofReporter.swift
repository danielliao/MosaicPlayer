import Foundation
import CryptoKit
import MosaicCore

@MainActor final class ProofReporter {
    private var tracker=EvidenceTracker(), queue=[PlaybackEvidence]()
    private var scope="", uploading=false, lastUpload=0.0
    private let delegate=NoRedirectDelegate()
    private lazy var session=URLSession(configuration:.ephemeral,delegate:delegate,delegateQueue:nil)
    func reset(){tracker.reset()}
    private func save(){queue=Array(queue.filter{$0.endAt>=Int64(Date().timeIntervalSince1970*1000)-7*86400000}.suffix(500));if let data=try? JSONEncoder().encode(queue){UserDefaults.standard.set(data,forKey:scope)}}
    func observe(_ sample:EvidenceSample,connection:PlayerConnection?) {
        guard let connection else {reset();return}
        let identity=connection.origin.absoluteString+"/"+connection.screenID+"/"+connection.key
        let next="mosaic-proof-"+SHA256.hash(data:Data(identity.utf8)).map{String(format:"%02x",$0)}.joined()
        if scope != next {scope=next;queue=(UserDefaults.standard.data(forKey:scope).flatMap{try? JSONDecoder().decode([PlaybackEvidence].self,from:$0)}) ?? [];tracker.reset()}
        if let event=tracker.observe(sample){queue.append(event);save()}
        guard !uploading,!queue.isEmpty,Date().timeIntervalSince1970-lastUpload>=10 else{return}
        lastUpload=Date().timeIntervalSince1970;uploading=true;let batch=Array(queue.prefix(50)),generation=scope
        Task { @MainActor [weak self] in
            guard let self else{return};defer{self.uploading=false}
            do {
                var request=connection.request("/api/device/play-events");request.httpMethod="POST";request.timeoutInterval=12
                request.setValue("application/json",forHTTPHeaderField:"Content-Type")
                // Explicit null is part of the collector contract for direct playback.
                let events=batch.map{e -> [String:Any] in ["eventId":e.eventId,"mediaId":e.mediaId,"programId":e.programId as Any? ?? NSNull(),"startAt":e.startAt,"endAt":e.endAt,"durationMs":e.durationMs]}
                request.httpBody=try JSONSerialization.data(withJSONObject:["events":events])
                let (data,response)=try await self.session.data(for:request)
                guard self.scope==generation,(response as? HTTPURLResponse)?.statusCode==200,let value=try JSONSerialization.jsonObject(with:data) as? [String:Any] else{return}
                let ids=Set((value["accepted"] as? [String] ?? [])+(value["rejected"] as? [[String:Any]] ?? []).compactMap{$0["eventId"] as? String})
                self.queue.removeAll{ids.contains($0.eventId)};self.save()
            }catch{}
        }
    }
}
