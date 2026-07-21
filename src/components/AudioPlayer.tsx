import { Pause, Play, RotateCcw, RotateCw, Volume2, VolumeX } from 'lucide-react'
import { memo, useEffect, useMemo, useRef, useState } from 'react'
import type { AppPreferences, TranscriptResult } from '../../electron/types'
import { formatDuration } from '../utils'
import { GlassSelect } from './GlassSelect'

const PLAYBACK_RATE_OPTIONS = [0.75, 1, 1.25, 1.5, 2].map((value) => ({ value: String(value), label: `${value}x` }))

interface AudioPlayerProps {
  transcript: TranscriptResult
  preferences: AppPreferences
  seekTo?: { time: number; nonce: number }
  onTimeChange(time: number): void
}

const WaveformBars = memo(function WaveformBars({ heights }: { heights: number[] }) {
  return <span className="waveform-bars">{heights.map((height, index) => <i key={index} style={{ height: `${height}%` }} />)}</span>
})

export const AudioPlayer = memo(function AudioPlayer({ transcript, preferences, seekTo, onTimeChange }: AudioPlayerProps) {
  const audioRef = useRef<HTMLAudioElement>(null)
  const [mediaUrl, setMediaUrl] = useState('')
  const [playing, setPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [rate, setRate] = useState(preferences.defaultPlaybackRate)
  const [volume, setVolume] = useState(preferences.defaultVolume)
  const [muted, setMuted] = useState(false)
  const duration = transcript.duration || audioRef.current?.duration || 0
  const waveform = useMemo(() => Array.from({ length: 104 }, (_, index) => {
    const value = Math.sin(index * 1.71) * 0.22 + Math.sin(index * 0.37) * 0.31 + 0.46
    return Math.max(16, Math.round(value * 100))
  }), [transcript.id])

  useEffect(() => {
    let active = true
    setMediaUrl('')
    setCurrentTime(0)
    if (import.meta.env.DEV && new URLSearchParams(location.search).has('demo')) {
      setMediaUrl('/demo-audio.wav')
      return
    }
    window.tingxie?.getMediaUrl(transcript.id).then((url) => { if (active) setMediaUrl(url) })
    return () => { active = false }
  }, [transcript.id])

  useEffect(() => {
    const audio = audioRef.current
    if (!audio || !seekTo) return
    audio.currentTime = Math.max(0, Math.min(duration, seekTo.time - preferences.seekLeadSeconds))
    setCurrentTime(audio.currentTime)
    onTimeChange(audio.currentTime)
  }, [seekTo?.nonce, duration, preferences.seekLeadSeconds, onTimeChange])

  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return
    audio.playbackRate = rate
    audio.volume = volume
    audio.muted = muted
  }, [rate, volume, muted, mediaUrl])

  function seek(time: number) {
    const next = Math.max(0, Math.min(duration, time))
    if (audioRef.current) audioRef.current.currentTime = next
    setCurrentTime(next)
    onTimeChange(next)
  }

  function handleTimeUpdate() {
    const audio = audioRef.current
    if (!audio) return
    let next = audio.currentTime
    if (preferences.skipSilence) {
      const silence = transcript.silences?.find((item) => next >= item.start && next < item.end && item.end - item.start >= preferences.minimumSilenceSeconds)
      if (silence && silence.end < duration - 0.05) {
        audio.currentTime = silence.end
        next = silence.end
      }
    }
    setCurrentTime(next)
    onTimeChange(next)
  }

  async function toggle() {
    const audio = audioRef.current
    if (!audio || !mediaUrl) return
    if (audio.paused) await audio.play()
    else audio.pause()
  }

  return <footer className="detail-player" aria-label="音频播放器">
    <audio ref={audioRef} src={mediaUrl || undefined} preload="metadata" onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)} onTimeUpdate={handleTimeUpdate} />
    <div className="player-controls">
      <button aria-label={`后退 ${preferences.seekSeconds} 秒`} onClick={() => seek(currentTime - preferences.seekSeconds)}><RotateCcw size={18} /><small>{preferences.seekSeconds}</small></button>
      <button className="player-play" aria-label={playing ? '暂停' : '播放'} disabled={!mediaUrl} onClick={toggle}>{playing ? <Pause size={19} fill="currentColor" /> : <Play size={19} fill="currentColor" />}</button>
      <button aria-label={`前进 ${preferences.seekSeconds} 秒`} onClick={() => seek(currentTime + preferences.seekSeconds)}><RotateCw size={18} /><small>{preferences.seekSeconds}</small></button>
    </div>
    <span className="player-time">{formatDuration(currentTime)}</span>
    <button className="waveform-track" aria-label="拖动播放进度" onClick={(event) => {
      const rect = event.currentTarget.getBoundingClientRect()
      seek((event.clientX - rect.left) / rect.width * duration)
    }}>
      <span className="waveform-progress" style={{ width: `${duration ? currentTime / duration * 100 : 0}%` }} />
      <WaveformBars heights={waveform} />
    </button>
    <span className="player-time">{formatDuration(duration)}</span>
    <label className="player-rate"><span>倍速</span><GlassSelect ariaLabel="播放速度" value={String(rate)} onValueChange={(value) => setRate(Number(value))} options={PLAYBACK_RATE_OPTIONS} size="compact" /></label>
    <button className="volume-button" aria-label={muted ? '取消静音' : '静音'} onClick={() => setMuted((value) => !value)}>{muted || volume === 0 ? <VolumeX size={18} /> : <Volume2 size={18} />}</button>
    <input className="volume-slider" aria-label="音量" type="range" min="0" max="1" step="0.05" value={volume} onChange={(event) => setVolume(Number(event.target.value))} />
    <span className={`skip-badge ${preferences.skipSilence ? 'active' : ''}`}>跳过静音 {preferences.skipSilence ? '开' : '关'}</span>
  </footer>
})
