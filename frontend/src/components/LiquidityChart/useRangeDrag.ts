import React, { useRef, useState, useCallback, useEffect } from 'react'

export interface DragState {
  isDragging: boolean
  draggingHandle: 'lower' | 'upper' | null
  visualPriceLower: number
  visualPriceUpper: number
}

interface UseRangeDragProps {
  initialLowerPrice: number
  initialUpperPrice: number
  domain: [number, number]
  onDragEnd: (handle: 'lower' | 'upper', finalPrice: number) => void
  onDragUpdate?: (handle: 'lower' | 'upper', currentPrice: number) => void
}

export function useRangeDrag({
  initialLowerPrice,
  initialUpperPrice,
  domain,
  onDragEnd,
  onDragUpdate
}: UseRangeDragProps) {
  const [dragState, setDragState] = useState<DragState>({
    isDragging: false,
    draggingHandle: null,
    visualPriceLower: initialLowerPrice,
    visualPriceUpper: initialUpperPrice,
  })

  // We use refs for transient drag state to avoid re-renders during active drag
  const dragContextRef = useRef<{
    handle: 'lower' | 'upper' | null;
    startClientX: number;
    startPrice: number;
    plotBox: { x: number; width: number } | null;
    pricePerPixel: number;
    latestClientX: number;
  }>({
    handle: null,
    startClientX: 0,
    startPrice: 0,
    plotBox: null,
    pricePerPixel: 0,
    latestClientX: 0
  })

  // Sync visual state if external props change while not dragging
  useEffect(() => {
    if (!dragState.isDragging && (dragState.visualPriceLower !== initialLowerPrice || dragState.visualPriceUpper !== initialUpperPrice)) {
      setDragState(prev => ({
        ...prev,
        visualPriceLower: initialLowerPrice,
        visualPriceUpper: initialUpperPrice
      }))
    }
  }, [dragState.isDragging, initialLowerPrice, initialUpperPrice])

  const setPlotBox = useCallback((box: { x: number; width: number }) => {
    dragContextRef.current.plotBox = box
  }, [])

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>, handle: 'lower' | 'upper') => {
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    
    const ctx = dragContextRef.current;
    
    let pp = 0;
    if (ctx.plotBox && ctx.plotBox.width > 0) {
      pp = (domain[1] - domain[0]) / ctx.plotBox.width;
    }

    const startPrice = handle === 'lower' ? dragState.visualPriceLower : dragState.visualPriceUpper;

    dragContextRef.current = {
      handle,
      startClientX: e.clientX,
      startPrice,
      plotBox: ctx.plotBox,
      pricePerPixel: pp,
      latestClientX: e.clientX
    }

    setDragState(prev => ({
      ...prev,
      isDragging: true,
      draggingHandle: handle,
    }))
  }, [dragState.visualPriceLower, dragState.visualPriceUpper, domain])

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const ctx = dragContextRef.current
    if (!ctx.handle || !ctx.plotBox || ctx.plotBox.width === 0 || ctx.pricePerPixel === 0) return

    ctx.latestClientX = e.clientX;

    const deltaX = e.clientX - ctx.startClientX
    let newPrice = ctx.startPrice + deltaX * ctx.pricePerPixel

    newPrice = Math.max(0, Math.min(9e15, newPrice))

    if (ctx.handle === 'lower') {
      newPrice = Math.min(newPrice, dragState.visualPriceUpper)
      setDragState(prev => ({ ...prev, visualPriceLower: newPrice }))
    } else {
      newPrice = Math.max(newPrice, dragState.visualPriceLower)
      setDragState(prev => ({ ...prev, visualPriceUpper: newPrice }))
    }

    if (onDragUpdate) {
      onDragUpdate(ctx.handle, newPrice)
    }
  }, [dragState.visualPriceLower, dragState.visualPriceUpper, onDragUpdate])

  const onPointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const ctx = dragContextRef.current
    if (!ctx.handle) return

    e.currentTarget.releasePointerCapture(e.pointerId)
    
    const finalPrice = ctx.handle === 'lower' ? dragState.visualPriceLower : dragState.visualPriceUpper
    onDragEnd(ctx.handle, finalPrice)

    ctx.handle = null
    setDragState(prev => ({
      ...prev,
      isDragging: false,
      draggingHandle: null,
    }))
  }, [dragState.visualPriceLower, dragState.visualPriceUpper, onDragEnd])

  const updateDragContextForNewDomain = useCallback((newTargetDomain: [number, number]) => {
    const ctx = dragContextRef.current;
    if (!ctx.handle || !ctx.plotBox || ctx.plotBox.width === 0) return;
    
    ctx.pricePerPixel = (newTargetDomain[1] - newTargetDomain[0]) / ctx.plotBox.width;
    ctx.startPrice = ctx.handle === 'lower' ? dragState.visualPriceLower : dragState.visualPriceUpper;
    ctx.startClientX = ctx.latestClientX;
  }, [dragState.visualPriceLower, dragState.visualPriceUpper]);

  return {
    dragState,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    setPlotBox,
    updateDragContextForNewDomain
  }
}
